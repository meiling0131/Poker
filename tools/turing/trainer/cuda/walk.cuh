// One DCFR iteration's tree walk for a batch of boards: one thread block per board, the same vector-form walk as
// solve.py (public chance sampling, all 1081 hands of both players at once), restructured around the abstraction:
//
// * Inside a street every strategy depends on the hand only through its bucket, so a player's reach at any node is
//   (reach at the street start) x (a per-bucket multiplier). Act nodes are handled per bucket by NB lanes (sig,
//   multipliers, Q = bucket sums of the child values, regrets), never per hand.
// * Per-hand work happens only at terminals (opponent mass with exact card removal: folds via per-card bucket sums,
//   showdowns via prefix sums over the sorted hands and the per-card lists) and at street changes. Each terminal
//   adds its values into the street start's per-hand accumulators V (weighted by the player's own multiplier) and
//   its bucket sums W go up the street's act nodes like values in an ordinary walk.
// * Threads own hands in the street's bucket order, so the bucket sums are cheap segmented warp reductions.
//
// The tree is compiled (export_tree.py) into a flat program of ops; every thread steps through it in lockstep.
#pragma once
#include "board.cuh"
#include <cub/block/block_scan.cuh>

enum : uint8_t {
  OP_ROOT_ENTER = 1, OP_ROOT_EXIT = 2, OP_ACT_ENTER = 3, OP_ACT_EXIT = 4, OP_CHILD = 5, OP_ACCUM = 6,
  OP_FOLD = 7, OP_SHOW = 8, OP_STREET_ENTER = 9, OP_STREET_EXIT = 10, OP_FOLDSHOW = 11
};
struct Op { uint8_t code, d, a, b; int32_t i; float x, y; };
static_assert(sizeof(Op) == 16, "op layout");

constexpr int WNT = 384, WHPT = 3;               // 12 warps, three hands per thread: 1152 slots >= 1081 hands;
                                                 // two blocks per SM, so one computes while the other waits at a barrier
constexpr int MAXD = 14, MAXLOC = 32, OPCH = 128;
using WB = BoardT<WNT, WHPT, 5>;
constexpr int WNP = WB::NP, WM = WB::M, WL = WB::L, WNV = WB::NV;

struct WalkParams {
  const Op* prog; int nops;
  const int* pf;                     // act ids of each street subtree, in program order
  const float* sig;                  // [nact][NTEX][NB][NSL] this iteration's strategy
  float* rinc; double* sinc;         // [rows][NSL], row = (keyid * NTEX + tex) * NB + bucket
  double* ev;                        // sum r0 * v0, sum r0 * T(r1)
  const uint8_t* boards; int nboards; int* counter;
  const uint8_t* flopB; const uint8_t* turnB;
  const float* rng;                  // [nlines][2][NH] each line's root reach (from the preflop strategy)
  float* lineval;                    // [nlines][2][NH] every hand's value at its line's root, summed over boards
  int* hcount;                       // [NH] boards each hand missed (was valid on)
  float* vsave;                      // [block][2 streets][2][WNP] flop / turn accumulators while a later street runs
  float* csave;                      // [block][2 streets][2][NB][WM] flop / turn reach by (bucket, card), the same
  int rthr[NB - 1];                  // river bucket thresholds on 2L + E
  uint8_t* dbgb;                     // tests: [nboards][3][NH] buckets, or null
};

struct F2Add {
  __device__ __forceinline__ float2 operator()(const float2& a, const float2& b) const { return make_float2(a.x + b.x, a.y + b.y); }
};
using WScan = cub::BlockScan<float2, WNT>;

struct WalkSM {
  WB::SM bd;
  uint8_t bucket[3][WNP];            // by vh; NB for padding
  int16_t ord[3][WNP];               // street order: position -> vh (bucket-sorted)
  int tex[3], fidx, tidx, next;
  int coff, ctex;                    // the current street subtree: its act ids' offset in pf, its texture
  float CS[2][NB][WM];               // the current street's start reach by (bucket, card)
  float Tot[3][2][NB];               // street-start reach by bucket
  float F[3][2][NB + 1];             // multiplier from this street's start to the next street's start
  float lm[MAXD][2][NB + 1];         // per level: reach multiplier since the street start
  float lsig[MAXD][NB][NSL];
  float lQ[MAXD][NB][NSL];
  float lW[MAXD][2][NB];             // per level: bucket sums of each player's values
  float Wpart[2][NB + 1];
  float Wpart2[2][NB + 1];           // a fused op's second child
  float CSmF[WM];                    // fused op: the folder's fold reach by card
  float MTF;
  float red[2][32];
  Op ops[OPCH];
  union {
    WB::Sort::TempStorage sort;
    struct { float rs[2][WNP]; float cum[2][WNP + 1]; float ccum[2][WM][WL + 1]; WScan::TempStorage scan; } sh;
    struct { float CSm[2][WM]; float MT[2]; } fo;
  } u;
};

struct TS {                          // one thread's hands on the current street
  int hv[WHPT], hb[WHPT], c1[WHPT], c2[WHPT];
  float R0[WHPT], R1[WHPT], V0[WHPT], V1[WHPT];
  int key; unsigned same; bool head;
};

__device__ __forceinline__ void load_slots(WalkSM& S, const WalkParams& P, TS& t, int s, int line) {
  const int tid = threadIdx.x, lane = tid & 31;
  const float* rr = P.rng + (size_t)line * 2 * NH;
#pragma unroll
  for (int q = 0; q < WHPT; q++) {
    const int v = S.ord[s][tid * WHPT + q];
    t.hv[q] = v;
    if (v < WNV) {
      t.hb[q] = S.bucket[s][v]; t.c1[q] = S.bd.c1[v]; t.c2[q] = S.bd.c2[v];
      const int h = S.bd.hidx[v];
      float r0 = __ldg(rr + h), r1 = __ldg(rr + NH + h);
      for (int s2 = 0; s2 < s; s2++) { const int b2 = S.bucket[s2][v]; r0 *= S.F[s2][0][b2]; r1 *= S.F[s2][1][b2]; }
      t.R0[q] = r0; t.R1[q] = r1;
    } else {
      t.hb[q] = NB; t.c1[q] = 0; t.c2[q] = 1; t.R0[q] = 0.f; t.R1[q] = 0.f;
    }
  }
  t.key = t.hb[WHPT - 1];
  unsigned same = 0;
#pragma unroll
  for (int o = 1, bit = 0; o < 32; o <<= 1, bit++) {
    const int k2 = __shfl_down_sync(0xffffffffu, t.key, o);
    if (lane + o < 32 && k2 == t.key) same |= 1u << bit;
  }
  const int kp = __shfl_up_sync(0xffffffffu, t.key, 1);
  t.same = same;
  t.head = lane == 0 || kp != t.key;
}

// bucket sums of two per-hand quantities into Wpart (hands are bucket-sorted across lanes)
__device__ __forceinline__ void reduce2(WalkSM& S, const TS& t, const float (&a0)[WHPT], const float (&a1)[WHPT], float (&Wp)[2][NB + 1]) {
  float s0 = 0.f, s1 = 0.f;
#pragma unroll
  for (int q = 0; q < WHPT; q++) {
    if (t.hb[q] == t.key) { s0 += a0[q]; s1 += a1[q]; }
    else if (t.hb[q] < NB) { atomicAdd(&Wp[0][t.hb[q]], a0[q]); atomicAdd(&Wp[1][t.hb[q]], a1[q]); }
  }
#pragma unroll
  for (int o = 1, bit = 0; o < 32; o <<= 1, bit++) {
    const float x0 = __shfl_down_sync(0xffffffffu, s0, o), x1 = __shfl_down_sync(0xffffffffu, s1, o);
    if (t.same >> bit & 1u) { s0 += x0; s1 += x1; }
  }
  if (t.head && t.key < NB) { atomicAdd(&Wp[0][t.key], s0); atomicAdd(&Wp[1][t.key], s1); }
}

__device__ __forceinline__ void finalize_w(WalkSM& S, int d) {
  const int tid = threadIdx.x;
  if (tid < 2 * NB) { const int x = tid / NB, b = tid % NB; S.lW[d][x][b] = S.Wpart[x][b]; S.Wpart[x][b] = 0.f; }
  __syncwarp();
}

// the street subtree being walked: where its act ids start in pf and its texture (ACT_ENTER reads the strategy
// straight from global memory; it stays in L2)
__device__ __forceinline__ void set_street(WalkSM& S, int off, int s) {
  if (threadIdx.x == 0) { S.coff = off; S.ctex = S.tex[s]; }
}

// a new street start: reach by (bucket, card) from u.sh.rs, by bucket from Wpart
__device__ __forceinline__ void street_sums(WalkSM& S, int s) {
  const int tid = threadIdx.x;
  if (tid < 2 * WM) {
    const int x = tid / WM, c = tid - x * WM;
    for (int b = 0; b < NB; b++) S.CS[x][b][c] = 0.f;
    for (int m = 0; m < WL; m++) {
      const int v = WB::member_vh(c, m);
      S.CS[x][S.bucket[s][v]][c] += S.u.sh.rs[x][v];
    }
  } else if (tid < 2 * WM + 2 * NB) {
    const int k = tid - 2 * WM, x = k / NB, b = k % NB;
    S.Tot[s][x][b] = S.Wpart[x][b]; S.Wpart[x][b] = 0.f;
  }
}

__device__ __forceinline__ void enter_street(WalkSM& S, const WalkParams& P, TS& t, int s, int d, int off, int cnt, int line) {
  load_slots(S, P, t, s, line);
#pragma unroll
  for (int q = 0; q < WHPT; q++) {
    t.V0[q] = 0.f; t.V1[q] = 0.f;
    S.u.sh.rs[0][t.hv[q]] = t.R0[q]; S.u.sh.rs[1][t.hv[q]] = t.R1[q];
  }
  reduce2(S, t, t.R0, t.R1, S.Wpart);
  set_street(S, off, s);
  if (threadIdx.x < NB) { S.lm[d][0][threadIdx.x] = 1.f; S.lm[d][1][threadIdx.x] = 1.f; }
  __syncthreads();
  street_sums(S, s);
  __syncthreads();
}

// prefix sums of both players' reach in u.sh.rs: over all hands in value order and over every card's list
__device__ __forceinline__ void show_scans(WalkSM& S) {
  const int tid = threadIdx.x;
  if (tid < 384) {                                   // per-card lists, four threads per list
    const bool act = tid < 2 * WM * 4;
    const int qq = tid & 3;
    int x = 0, i = 0;
    if (act) { x = tid / (4 * WM); i = (tid - x * 4 * WM) >> 2; }
    const int lo = qq * 12, hi = min(lo + 12, WL);
    float vals[12], tot = 0.f;
#pragma unroll
    for (int j = 0; j < 12; j++) {
      float v = 0.f;
      if (act && lo + j < hi) v = S.u.sh.rs[x][S.bd.lord[i][lo + j]];
      vals[j] = v; tot += v;
    }
    float inc = tot;
#pragma unroll
    for (int o = 1; o < 4; o <<= 1) { const float y = __shfl_up_sync(0xffffffffu, inc, o, 4); if (qq >= o) inc += y; }
    if (act) {
      float a = inc - tot;
      float* cc = S.u.sh.ccum[x][i];
#pragma unroll
      for (int j = 0; j < 12; j++) if (lo + j < hi) { cc[lo + j] = a; a += vals[j]; }
      if (qq == 3) cc[WL] = a;
    }
  }
  {                                                  // all hands in value order
    float2 in[WHPT], out[WHPT], agg;
#pragma unroll
    for (int q = 0; q < WHPT; q++) {
      const int v = S.bd.perm[tid * WHPT + q];
      in[q] = make_float2(S.u.sh.rs[0][v], S.u.sh.rs[1][v]);
    }
    WScan(S.u.sh.scan).ExclusiveScan(in, out, make_float2(0.f, 0.f), F2Add(), agg);
#pragma unroll
    for (int q = 0; q < WHPT; q++) { S.u.sh.cum[0][tid * WHPT + q] = out[q].x; S.u.sh.cum[1][tid * WHPT + q] = out[q].y; }
    if (tid == 0) { S.u.sh.cum[0][WNP] = agg.x; S.u.sh.cum[1][WNP] = agg.y; }
  }
}

struct LET { float L, E, T; };
// opponent o's reach that hand v beats (L), ties (E) and faces (T), exact card removal
__device__ __forceinline__ LET let_of(const WalkSM& S, int o, int v, int c1, int c2, int gsv, int gev, int la, int ea,
                                      int lb, int eb) {
  const float* cum = S.u.sh.cum[o];
  const float* ca = S.u.sh.ccum[o][c1];
  const float* cb = S.u.sh.ccum[o][c2];
  const float rself = S.u.sh.rs[o][v];
  const float Lall = cum[gsv], Eall = cum[gev] - Lall, lca = ca[la], lcb = cb[lb];
  return LET{Lall - lca - lcb, Eall - (ca[ea] - lca) - (cb[eb] - lcb) + rself, cum[WNP] - ca[WL] - cb[WL] + rself};
}

__global__ void __launch_bounds__(WNT, 2) walk_kernel(WalkParams P) {
  extern __shared__ __align__(16) char smraw[];
  WalkSM& S = *reinterpret_cast<WalkSM*>(smraw);
  const int tid = threadIdx.x, lane = tid & 31, wid = tid >> 5;
  for (int i = tid; i < MAXD * 2; i += WNT) S.lm[i >> 1][i & 1][NB] = 0.f;
  for (int i = tid; i < 3 * 2; i += WNT) S.F[i >> 1][i & 1][NB] = 0.f;
  for (int i = tid; i < 2 * (NB + 1); i += WNT) { (&S.Wpart[0][0])[i] = 0.f; (&S.Wpart2[0][0])[i] = 0.f; }
  TS t;
  int line = 0;                       // the line being walked (uniform across the block)

  for (;;) {
    __syncthreads();
    if (tid == 0) S.next = atomicAdd(P.counter, 1);
    __syncthreads();
    const int bi = S.next;
    if (bi >= P.nboards) break;

    // ---- the board: hands, values, buckets, street orders
    if (tid < 5) S.bd.board[tid] = P.boards[(size_t)bi * 5 + tid];
    __syncthreads();
    if (tid < 3) {
      int c[5];
      for (int j = 0; j < 3 + tid; j++) c[j] = S.bd.board[j];
      S.tex[tid] = tex_class(c, 3 + tid);
    } else if (tid == 32) {
      int c[4];
      for (int j = 0; j < 3; j++) c[j] = S.bd.board[j];
      sort_small(c, 3); S.fidx = (int)colex(c, 3);
      for (int j = 0; j < 4; j++) c[j] = S.bd.board[j];
      sort_small(c, 4); S.tidx = (int)colex(c, 4);
    }
    WB::build(S.bd, S.u.sort);
#pragma unroll
    for (int q = 0; q < WHPT; q++) {
      const int v = tid * WHPT + q;
      if (v < WNV) {
        const int h = S.bd.hidx[v];
        const int fb = __ldg(P.flopB + (size_t)S.fidx * NH + h), tb = __ldg(P.turnB + (size_t)S.tidx * NH + h);
        const int k = S.bd.hs[v];
        int rb = 0;
        for (int e = 0; e < NB - 1; e++) rb += k >= P.rthr[e];
        S.bucket[0][v] = (uint8_t)fb; S.bucket[1][v] = (uint8_t)tb; S.bucket[2][v] = (uint8_t)rb;
        atomicAdd(P.hcount + h, 1);
        if (P.dbgb) {
          P.dbgb[((size_t)bi * 3 + 0) * NH + h] = (uint8_t)fb;
          P.dbgb[((size_t)bi * 3 + 1) * NH + h] = (uint8_t)tb;
          P.dbgb[((size_t)bi * 3 + 2) * NH + h] = (uint8_t)rb;
        }
      } else {
        S.bucket[0][v] = NB; S.bucket[1][v] = NB; S.bucket[2][v] = NB;
      }
    }
    __syncthreads();
    for (int s = 0; s < 3; s++) {
      uint32_t k2[WHPT]; int16_t v2[WHPT];
#pragma unroll
      for (int q = 0; q < WHPT; q++) { const int v = tid * WHPT + q; k2[q] = S.bucket[s][v]; v2[q] = (int16_t)v; }
      WB::Sort(S.u.sort).Sort(k2, v2, 0, BUCKET_BITS);
#pragma unroll
      for (int q = 0; q < WHPT; q++) S.ord[s][tid * WHPT + q] = v2[q];
      __syncthreads();
    }

    // ---- the program
    for (int pc0 = 0; pc0 < P.nops; pc0 += OPCH) {
      const int n = min(OPCH, P.nops - pc0);
      __syncthreads();
      for (int i = tid; i < n; i += WNT) S.ops[i] = P.prog[pc0 + i];
      __syncthreads();
      for (int k = 0; k < n; k++) {
        const Op op = S.ops[k];
        const int d = op.d;
        switch (op.code) {
        case OP_ACT_ENTER:
          if (tid < NB) {
            const float* src = P.sig + ((size_t)__ldg(P.pf + S.coff + op.a) * NTEX + S.ctex) * (NB * NSL) + tid * NSL;
            for (int sl = 0; sl < NSL; sl++) { S.lsig[d][tid][sl] = __ldg(src + sl); S.lQ[d][tid][sl] = 0.f; }
            S.lW[d][0][tid] = 0.f; S.lW[d][1][tid] = 0.f;
          }
          break;
        case OP_CHILD:
          if (tid < NB) {
            const int p = op.b;
            S.lm[op.i][p][tid] = S.lm[d][p][tid] * S.lsig[d][tid][op.a];      // op.i: the child's level
            S.lm[op.i][1 - p][tid] = S.lm[d][1 - p][tid];
          }
          break;
        case OP_ACCUM:
          if (tid < NB) {
            const int p = op.b;
            const float w = S.lW[op.i][p][tid];
            S.lQ[d][tid][op.a] = w;
            S.lW[d][p][tid] += S.lsig[d][tid][op.a] * w;
            S.lW[d][1 - p][tid] += S.lW[op.i][1 - p][tid];
          }
          break;
        case OP_ACT_EXIT:
          if (tid < NB) {
            const int p = op.b & 1, s = op.b >> 1, b = tid;
            float ev = 0.f;
            for (int sl = 0; sl < NSL; sl++) ev += S.lsig[d][b][sl] * S.lQ[d][b][sl];
            const size_t row = ((size_t)(op.i * NTEX + S.tex[s]) * NB + b) * NSL;
            const float reach = S.lm[d][p][b] * S.Tot[s][p][b];
            for (int sl = 0; sl < NSL; sl++) {
              if (!(op.a >> sl & 1)) continue;
              const float r = S.lQ[d][b][sl] - ev;
              if (r != 0.f) atomicAdd(P.rinc + row + sl, r);
              const float w = S.lsig[d][b][sl] * reach;
              if (w != 0.f) atomicAdd(P.sinc + row + sl, (double)w);
            }
          }
          break;
        case OP_FOLD: {
          const int s = op.b, f = op.a;
          __syncthreads();
          if (tid < 2 * WM) {
            const int x = tid / WM, c = tid - x * WM;
            float acc = 0.f;
            for (int b = 0; b < NB; b++) acc += S.lm[d][x][b] * S.CS[x][b][c];
            S.u.fo.CSm[x][c] = acc;
          } else if (tid < 2 * WM + 2) {
            const int x = tid - 2 * WM;
            float acc = 0.f;
            for (int b = 0; b < NB; b++) acc += S.lm[d][x][b] * S.Tot[s][x][b];
            S.u.fo.MT[x] = acc;
          }
          __syncthreads();
          const float g0 = f == 0 ? -op.x : op.x;        // player 0 loses what it put in when it folds
          float u0[WHPT], u1[WHPT];
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int b = t.hb[q];
            const float m0 = S.lm[d][0][b], m1 = S.lm[d][1][b];
            const float T0 = S.u.fo.MT[0] - S.u.fo.CSm[0][t.c1[q]] - S.u.fo.CSm[0][t.c2[q]] + m0 * t.R0[q];
            const float T1 = S.u.fo.MT[1] - S.u.fo.CSm[1][t.c1[q]] - S.u.fo.CSm[1][t.c2[q]] + m1 * t.R1[q];
            u0[q] = g0 * T1; u1[q] = -g0 * T0;
            t.V0[q] += m0 * u0[q]; t.V1[q] += m1 * u1[q];
          }
          reduce2(S, t, u0, u1, S.Wpart);
          __syncthreads();
          finalize_w(S, d);
        } break;
        case OP_SHOW: {
          const float c = op.x;
          __syncthreads();
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int b = t.hb[q];
            S.u.sh.rs[0][t.hv[q]] = t.R0[q] * S.lm[d][0][b];
            S.u.sh.rs[1][t.hv[q]] = t.R1[q] * S.lm[d][1][b];
          }
          __syncthreads();
          show_scans(S);
          __syncthreads();
          float u[2][WHPT];
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int v = t.hv[q];
            if (v >= WNV) { u[0][q] = 0.f; u[1][q] = 0.f; continue; }
            const int c1 = t.c1[q], c2 = t.c2[q], gsv = S.bd.gs[v], gev = S.bd.ge[v];
            const int la = S.bd.lgs[c1][c2 - 1], ea = S.bd.lge[c1][c2 - 1], lb = S.bd.lgs[c2][c1], eb = S.bd.lge[c2][c1];
#pragma unroll
            for (int me = 0; me < 2; me++) {
              const LET r = let_of(S, 1 - me, v, c1, c2, gsv, gev, la, ea, lb, eb);
              u[me][q] = c * (2.f * r.L + r.E - r.T);
            }
            const int b = t.hb[q];
            t.V0[q] += S.lm[d][0][b] * u[0][q];
            t.V1[q] += S.lm[d][1][b] * u[1][q];
          }
          reduce2(S, t, u[0], u[1], S.Wpart);
          __syncthreads();
          finalize_w(S, d);
        } break;
        case OP_FOLDSHOW: {                                  // fold child at level d, call-to-showdown child at op.i
          const int f = op.a, s = op.b, ds = op.i;
          const float loss = op.x, c = op.y;
          __syncthreads();
          if (tid < WM) {
            float acc = 0.f;
            for (int b = 0; b < NB; b++) acc += S.lm[d][f][b] * S.CS[f][b][tid];
            S.CSmF[tid] = acc;
          } else if (tid == WM) {
            float acc = 0.f;
            for (int b = 0; b < NB; b++) acc += S.lm[d][f][b] * S.Tot[s][f][b];
            S.MTF = acc;
          }
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int b = t.hb[q];
            S.u.sh.rs[0][t.hv[q]] = t.R0[q] * S.lm[ds][0][b];
            S.u.sh.rs[1][t.hv[q]] = t.R1[q] * S.lm[ds][1][b];
          }
          __syncthreads();
          show_scans(S);
          __syncthreads();
          float uf[2][WHPT], us[2][WHPT];
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int v = t.hv[q];
            if (v >= WNV) { uf[0][q] = 0.f; uf[1][q] = 0.f; us[0][q] = 0.f; us[1][q] = 0.f; continue; }
            const int c1 = t.c1[q], c2 = t.c2[q], gsv = S.bd.gs[v], gev = S.bd.ge[v];
            const int la = S.bd.lgs[c1][c2 - 1], ea = S.bd.lge[c1][c2 - 1], lb = S.bd.lgs[c2][c1], eb = S.bd.lge[c2][c1];
            const int b = t.hb[q];
            const float Rf = f == 0 ? t.R0[q] : t.R1[q];
#pragma unroll
            for (int me = 0; me < 2; me++) {
              const LET r = let_of(S, 1 - me, v, c1, c2, gsv, gev, la, ea, lb, eb);
              us[me][q] = c * (2.f * r.L + r.E - r.T);
              // the folder loses its chips against all of the opponent's reach (the same reach as at the
              // showdown); the other player wins them against the folder's fold reach
              uf[me][q] = me == f ? -loss * r.T : loss * (S.MTF - S.CSmF[c1] - S.CSmF[c2] + S.lm[d][f][b] * Rf);
            }
            t.V0[q] += S.lm[d][0][b] * uf[0][q] + S.lm[ds][0][b] * us[0][q];
            t.V1[q] += S.lm[d][1][b] * uf[1][q] + S.lm[ds][1][b] * us[1][q];
          }
          reduce2(S, t, uf[0], uf[1], S.Wpart);
          reduce2(S, t, us[0], us[1], S.Wpart2);
          __syncthreads();
          if (tid < 2 * NB) {
            const int x = tid / NB, b = tid % NB;
            S.lW[d][x][b] = S.Wpart[x][b]; S.Wpart[x][b] = 0.f;
            S.lW[ds][x][b] = S.Wpart2[x][b]; S.Wpart2[x][b] = 0.f;
          }
          __syncwarp();
        } break;
        case OP_STREET_ENTER: {
          const int s1 = op.a, s = s1 - 1;
          __syncthreads();
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int p = tid * WHPT + q;
            float* vs = P.vsave + (size_t)blockIdx.x * 4 * WNP + (size_t)s * 2 * WNP;
            vs[p] = t.V0[q]; vs[WNP + p] = t.V1[q];
          }
          if (tid < 2 * NB) { const int x = tid / NB, b = tid % NB; S.F[s][x][b] = S.lm[d][x][b]; }
          {                                                  // this street's reach by (bucket, card) waits in global memory
            float* cs = P.csave + ((size_t)blockIdx.x * 2 + s) * (2 * NB * WM);
            for (int i = tid; i < 2 * NB * WM; i += WNT) cs[i] = (&S.CS[0][0][0])[i];
          }
          __syncthreads();
          enter_street(S, P, t, s1, d, op.i, op.b, line);
        } break;
        case OP_STREET_EXIT: {
          const int s = op.a;
          __syncthreads();
          {                                                  // back to this street's reach by (bucket, card)
            const float* cs = P.csave + ((size_t)blockIdx.x * 2 + s) * (2 * NB * WM);
            for (int i = tid; i < 2 * NB * WM; i += WNT) (&S.CS[0][0][0])[i] = cs[i];   // each thread its own entries
          }
#pragma unroll
          for (int q = 0; q < WHPT; q++) { S.u.sh.rs[0][t.hv[q]] = t.V0[q]; S.u.sh.rs[1][t.hv[q]] = t.V1[q]; }
          __syncthreads();
          load_slots(S, P, t, s, line);
          float u0[WHPT], u1[WHPT];
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            const int p = tid * WHPT + q, v = t.hv[q], b = t.hb[q];
            u0[q] = S.u.sh.rs[0][v]; u1[q] = S.u.sh.rs[1][v];
            const float* vs = P.vsave + (size_t)blockIdx.x * 4 * WNP + (size_t)s * 2 * WNP;
            t.V0[q] = vs[p] + S.F[s][0][b] * u0[q];
            t.V1[q] = vs[WNP + p] + S.F[s][1][b] * u1[q];
          }
          reduce2(S, t, u0, u1, S.Wpart);
          set_street(S, op.i, s);
          __syncthreads();
          finalize_w(S, d);
        } break;
        case OP_ROOT_ENTER:
          __syncthreads();
          line = op.a;
          enter_street(S, P, t, 0, 0, op.i, op.b, line);
          break;
        case OP_ROOT_EXIT: {
          __syncthreads();
          float num = 0.f, den = 0.f;
#pragma unroll
          for (int q = 0; q < WHPT; q++) {
            if (t.hv[q] >= WNV) continue;
            {
              float* lv = P.lineval + (size_t)line * 2 * NH + S.bd.hidx[t.hv[q]];
              atomicAdd(lv, t.V0[q]);
              atomicAdd(lv + NH, t.V1[q]);
            }
            float T1 = t.R1[q];
            for (int b = 0; b < NB; b++) T1 += S.Tot[0][1][b] - S.CS[1][b][t.c1[q]] - S.CS[1][b][t.c2[q]];   // back on the flop
            num += t.R0[q] * t.V0[q];
            den += t.R0[q] * T1;
          }
          for (int o = 16; o > 0; o >>= 1) { num += __shfl_down_sync(0xffffffffu, num, o); den += __shfl_down_sync(0xffffffffu, den, o); }
          if (lane == 0) { S.red[0][wid] = num; S.red[1][wid] = den; }
          __syncthreads();
          if (tid < 32) {
            float a = tid < WNT / 32 ? S.red[0][tid] : 0.f, b = tid < WNT / 32 ? S.red[1][tid] : 0.f;
            for (int o = 16; o > 0; o >>= 1) { a += __shfl_down_sync(0xffffffffu, a, o); b += __shfl_down_sync(0xffffffffu, b, o); }
            if (tid == 0) { atomicAdd(P.ev, (double)a); atomicAdd(P.ev + 1, (double)b); }
          }
        } break;
        default: break;
        }
      }
    }
  }
}
