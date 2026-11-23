// Exact hand buckets for the flop and turn, computed once for every possible board (no Monte Carlo):
//   river_pass: every 5-card board -> each valid hand's river strength (2L + E against all valid opponents), added
//               into its 10 flops and 5 turns (so flop/turn expected river strength is the exact average over runouts),
//               and a histogram of the river strength (for the river bucket edges);
//   acc_hist:   histograms of the flop / turn expected strength (for their bucket edges);
//   now_pass:   per flop / turn: strength now, then bucket = 2 * bin(expected strength) + (draw: gain > potT).
// solve.py computes the same quantities with random runouts on a pool of boards; here they are exact.
#pragma once
#include "board.cuh"

constexpr int PNT = 608, PHPT = 2;   // precompute blocks: 1216 slots >= 1176 flop hands

__host__ __device__ inline void hand_cards(int h, int& a, int& b) {
  a = 0;
  while (h >= 51 - a) { h -= 51 - a; a++; }
  b = a + 1 + h;
}

template <int K>
struct PreSM {
  using B = BoardT<PNT, PHPT, K>;
  typename B::SM s;
  typename B::Sort::TempStorage tmp;
  unsigned int hist[1981];
  int fidx[10], tidx[5];
};

__global__ void __launch_bounds__(PNT) river_pass(int* flopAcc, int* turnAcc, unsigned long long* histR) {
  using B = BoardT<PNT, PHPT, 5>;
  extern __shared__ __align__(16) char smraw[];
  PreSM<5>& S = *reinterpret_cast<PreSM<5>*>(smraw);
  const int tid = threadIdx.x;
  for (int i = tid; i < 1981; i += PNT) S.hist[i] = 0;
  for (uint32_t bi = blockIdx.x; bi < (uint32_t)NRIVER; bi += gridDim.x) {
    __syncthreads();
    if (tid == 0) {
      int c[5];
      uncolex(bi, 5, c);
      for (int k = 0; k < 5; k++) S.s.board[k] = c[k];
      int n = 0;
      for (int a = 0; a < 5; a++)
        for (int b = a + 1; b < 5; b++)
          for (int d = b + 1; d < 5; d++) { int t[3] = {c[a], c[b], c[d]}; S.fidx[n++] = (int)colex(t, 3); }
      for (int skip = 0; skip < 5; skip++) {
        int t[4], m = 0;
        for (int k = 0; k < 5; k++) if (k != skip) t[m++] = c[k];
        S.tidx[skip] = (int)colex(t, 4);
      }
    }
    __syncthreads();
    B::build(S.s, S.tmp);
#pragma unroll
    for (int q = 0; q < PHPT; q++) {
      int v = tid * PHPT + q;
      if (v < B::NV) {
        int h = S.s.hidx[v], k = S.s.hs[v];
        atomicAdd(&S.hist[k], 1u);
        for (int f = 0; f < 10; f++) atomicAdd(&flopAcc[(size_t)S.fidx[f] * NH + h], k);
        for (int t = 0; t < 5; t++) atomicAdd(&turnAcc[(size_t)S.tidx[t] * NH + h], k);
      }
    }
  }
  __syncthreads();
  for (int i = tid; i < 1981; i += PNT) if (S.hist[i]) atomicAdd(&histR[i], (unsigned long long)S.hist[i]);
}

// histogram of acc over (board subset, hand missing it)
__global__ void acc_hist(const int* acc, int nsub, int K, unsigned long long* hist) {
  __shared__ uint64_t used;
  for (int sub = blockIdx.x; sub < nsub; sub += gridDim.x) {
    __syncthreads();
    if (threadIdx.x == 0) {
      int c[4];
      uncolex((uint32_t)sub, K, c);
      uint64_t u = 0;
      for (int k = 0; k < K; k++) u |= 1ull << c[k];
      used = u;
    }
    __syncthreads();
    uint64_t u = used;
    for (int h = threadIdx.x; h < NH; h += blockDim.x) {
      int a, b;
      hand_cards(h, a, b);
      if ((u >> a & 1ull) || (u >> b & 1ull)) continue;
      atomicAdd(&hist[acc[(size_t)sub * NH + h]], 1ull);
    }
  }
}

struct Edges4 { double e[4]; };

template <int K>
__global__ void __launch_bounds__(PNT) now_pass(const int* acc, Edges4 E, double accDen, double potT, uint8_t* table) {
  using B = BoardT<PNT, PHPT, K>;
  extern __shared__ __align__(16) char smraw[];
  PreSM<K>& S = *reinterpret_cast<PreSM<K>*>(smraw);
  const int tid = threadIdx.x;
  const int nsub = K == 3 ? NFLOP : NTURN;
  for (int sub = blockIdx.x; sub < nsub; sub += gridDim.x) {
    __syncthreads();
    if (tid == 0) {
      int c[4];
      uncolex((uint32_t)sub, K, c);
      for (int k = 0; k < K; k++) S.s.board[k] = c[k];
    }
    __syncthreads();
    B::build(S.s, S.tmp);
#pragma unroll
    for (int q = 0; q < PHPT; q++) {
      int v = tid * PHPT + q;
      if (v < B::NV) {
        int h = S.s.hidx[v];
        double ehs = acc[(size_t)sub * NH + h] / accDen;
        double now = S.s.hs[v] / (2.0 * B::TOPP);
        int bin = 0;
        for (int e = 0; e < 4; e++) bin += ehs > E.e[e];
        table[(size_t)sub * NH + h] = (uint8_t)(bin * 2 + (ehs - now > potT ? 1 : 0));
      }
    }
  }
}

// tests: hand values and strength-now numerators of given boards, by poker.py hand number
template <int K>
__global__ void __launch_bounds__(PNT) hs_test(const int* boards, int n, uint32_t* vals, int16_t* hs) {
  using B = BoardT<PNT, PHPT, K>;
  extern __shared__ __align__(16) char smraw[];
  PreSM<K>& S = *reinterpret_cast<PreSM<K>*>(smraw);
  const int tid = threadIdx.x;
  for (int bi = blockIdx.x; bi < n; bi += gridDim.x) {
    __syncthreads();
    if (tid < K) S.s.board[tid] = boards[bi * K + tid];
    for (int h = tid; h < NH; h += PNT) { vals[(size_t)bi * NH + h] = 0xFFFFFFFFu; hs[(size_t)bi * NH + h] = -1; }
    __syncthreads();
    B::build(S.s, S.tmp);
#pragma unroll
    for (int q = 0; q < PHPT; q++) {
      int v = tid * PHPT + q;
      if (v < B::NV) {
        int h = S.s.hidx[v];
        vals[(size_t)bi * NH + h] = S.s.key[S.s.gs[v]];
        hs[(size_t)bi * NH + h] = S.s.hs[v];
      }
    }
  }
}

// ---- the finer abstraction: flop / turn bucket = NPB * bin(expected strength) + bin(potential within that bin), where
// potential = expected river strength minus strength now (draws gain, vulnerable made hands lose); the potential edges
// are quantiles inside each strength bin, so every bucket holds a share of the hands of its strength bin.
constexpr int GRES = 2000, NGB = 2 * GRES + 1;      // potential histogram over [-1, 1] in steps of 1/2000
struct EdgesE { double e[NE - 1]; };
struct Edges2 { double e[NE - 1]; double g[NE][NPB - 1]; };

__host__ __device__ inline int ebin_of(double ehs, const double* e) {
  int b = 0;
  for (int i = 0; i < NE - 1; i++) b += ehs > e[i];
  return b;
}

// per strength bin, a histogram of the potential of every (flop or turn, hand that misses it)
template <int K>
__global__ void __launch_bounds__(PNT) gain_hist(const int* acc, EdgesE E, double accDen, unsigned long long* hist) {
  using B = BoardT<PNT, PHPT, K>;
  extern __shared__ __align__(16) char smraw[];
  PreSM<K>& S = *reinterpret_cast<PreSM<K>*>(smraw);
  const int tid = threadIdx.x;
  const int nsub = K == 3 ? NFLOP : NTURN;
  for (int sub = blockIdx.x; sub < nsub; sub += gridDim.x) {
    __syncthreads();
    if (tid == 0) {
      int c[4];
      uncolex((uint32_t)sub, K, c);
      for (int k = 0; k < K; k++) S.s.board[k] = c[k];
    }
    __syncthreads();
    B::build(S.s, S.tmp);
#pragma unroll
    for (int q = 0; q < PHPT; q++) {
      int v = tid * PHPT + q;
      if (v < B::NV) {
        int h = S.s.hidx[v];
        double ehs = acc[(size_t)sub * NH + h] / accDen;
        double now = S.s.hs[v] / (2.0 * B::TOPP);
        int gb = (int)floor((ehs - now + 1.0) * GRES);
        gb = gb < 0 ? 0 : gb >= NGB ? NGB - 1 : gb;
        atomicAdd(&hist[(size_t)ebin_of(ehs, E.e) * NGB + gb], 1ull);
      }
    }
  }
}

template <int K>
__global__ void __launch_bounds__(PNT) now_pass2(const int* acc, Edges2 E, double accDen, uint8_t* table) {
  using B = BoardT<PNT, PHPT, K>;
  extern __shared__ __align__(16) char smraw[];
  PreSM<K>& S = *reinterpret_cast<PreSM<K>*>(smraw);
  const int tid = threadIdx.x;
  const int nsub = K == 3 ? NFLOP : NTURN;
  for (int sub = blockIdx.x; sub < nsub; sub += gridDim.x) {
    __syncthreads();
    if (tid == 0) {
      int c[4];
      uncolex((uint32_t)sub, K, c);
      for (int k = 0; k < K; k++) S.s.board[k] = c[k];
    }
    __syncthreads();
    B::build(S.s, S.tmp);
#pragma unroll
    for (int q = 0; q < PHPT; q++) {
      int v = tid * PHPT + q;
      if (v < B::NV) {
        int h = S.s.hidx[v];
        double ehs = acc[(size_t)sub * NH + h] / accDen;
        double now = S.s.hs[v] / (2.0 * B::TOPP);
        double gain = ehs - now;
        int eb = ebin_of(ehs, E.e), pb = 0;
        for (int i = 0; i < NPB - 1; i++) pb += gain > E.g[eb][i];
        table[(size_t)sub * NH + h] = (uint8_t)(eb * NPB + pb);
      }
    }
  }
}
