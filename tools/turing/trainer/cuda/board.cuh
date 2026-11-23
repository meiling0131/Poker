// One board, worked out by one thread block: the valid hands, their values sorted with equal-value groups, and for
// every card the hands holding it, sorted the same way. This is poker.py's Showdown in compact form (only the hands
// that miss the board), plus each hand's strength now (2L + E against all valid opponent hands, exact card removal).
#pragma once
#include "common.cuh"
#include <cub/block/block_radix_sort.cuh>

template <int NT, int HPT, int K>
struct BoardT {
  static constexpr int M = 52 - K;               // cards left
  static constexpr int NV = M * (M - 1) / 2;     // hands that miss the board ("valid"), numbered vh
  static constexpr int L = M - 1;                // hands holding one given card
  static constexpr int NP = NT * HPT;            // padded slots
  static constexpr int TOPP = (M - 2) * (M - 3) / 2;   // valid opponent hands of a valid hand
  static_assert(NP >= NV, "not enough slots for the hands");
  static_assert(NT >= 52, "need a thread per card");
  using Sort = cub::BlockRadixSort<uint32_t, NT, HPT, int16_t>;

  struct SM {
    int board[K];
    uint8_t rem[M];                  // the cards left, ascending (compact card i = rem[i])
    uint8_t c1[NP], c2[NP];          // the hand's compact cards, c1 < c2
    int16_t hidx[NP];                // poker.py hand number, -1 for padding
    uint32_t key[NP];                // hand values, sorted
    int16_t perm[NP];                // sorted position -> vh
    int16_t gs[NP], ge[NP];          // per vh: its equal-value group [gs, ge) in sorted positions
    int16_t lord[M][L];              // card list i in sorted order -> vh
    uint8_t lgs[M][L], lge[M][L];    // per list member: its equal-value group inside the sorted list
    int16_t hs[NP];                  // 2L + E (strength * 2 * TOPP), -1 for padding
  };

  __host__ __device__ static int pair_vh(int i, int j) { return i * (2 * M - i - 1) / 2 + (j - i - 1); }
  __host__ __device__ static void unpair(int v, int& i, int& j) {
    i = 0;
    while (v >= M - 1 - i) { v -= M - 1 - i; i++; }
    j = i + 1 + v;
  }
  // member m of card i's list: the hand of compact cards i and (m < i ? m : m + 1)
  __host__ __device__ static int member_vh(int i, int m) {
    int j = m < i ? m : m + 1;
    return i < j ? pair_vh(i, j) : pair_vh(j, i);
  }
  // where hand (i < j) sits in its two lists: member j-1 of list i, member i of list j

  // s.board must be set and visible before the call; ends with a barrier
  __device__ static void build(SM& s, typename Sort::TempStorage& tmp) {
    const int tid = threadIdx.x;
    if (tid < 52) {
      bool on = false; int less = 0;
      for (int k = 0; k < K; k++) { on |= s.board[k] == tid; less += s.board[k] < tid; }
      if (!on) s.rem[tid - less] = (uint8_t)tid;
    }
    __syncthreads();
    uint32_t keys[HPT]; int16_t vals[HPT];
#pragma unroll
    for (int q = 0; q < HPT; q++) {
      int v = tid * HPT + q;
      if (v < NV) {
        int i, j; unpair(v, i, j);
        int cs[7];
        cs[0] = s.rem[i]; cs[1] = s.rem[j];
        for (int k = 0; k < K; k++) cs[2 + k] = s.board[k];
        s.c1[v] = (uint8_t)i; s.c2[v] = (uint8_t)j;
        s.hidx[v] = (int16_t)hand_index(cs[0], cs[1]);
        keys[q] = eval_hand(cs, K + 2);
      } else {
        s.c1[v] = 0; s.c2[v] = 1; s.hidx[v] = -1;
        keys[q] = 0xFFFFFFu;                         // above every hand value (< 9 * 2^20)
      }
      vals[q] = (int16_t)v;
    }
    Sort(tmp).Sort(keys, vals, 0, 24);
#pragma unroll
    for (int q = 0; q < HPT; q++) { int p = tid * HPT + q; s.key[p] = keys[q]; s.perm[p] = vals[q]; }
    __syncthreads();
#pragma unroll
    for (int q = 0; q < HPT; q++) {
      int p = tid * HPT + q;
      uint32_t k = s.key[p];
      int lo = 0, hi = NP;
      while (lo < hi) { int mid = (lo + hi) >> 1; if (s.key[mid] < k) lo = mid + 1; else hi = mid; }
      int a = lo;
      hi = NP;
      while (lo < hi) { int mid = (lo + hi) >> 1; if (s.key[mid] <= k) lo = mid + 1; else hi = mid; }
      s.gs[s.perm[p]] = (int16_t)a;
      s.ge[s.perm[p]] = (int16_t)lo;
    }
    __syncthreads();
    for (int w = tid; w < M * L; w += NT) {           // card lists: rank every member among its list
      int i = w / L, m = w % L;
      int me = member_vh(i, m);
      uint32_t v = s.key[s.gs[me]];
      int lt = 0, le = 0, eqb = 0;
      for (int m2 = 0; m2 < L; m2++) {
        uint32_t v2 = s.key[s.gs[member_vh(i, m2)]];
        lt += v2 < v; le += v2 <= v; eqb += (v2 == v) & (m2 < m);
      }
      s.lgs[i][m] = (uint8_t)lt; s.lge[i][m] = (uint8_t)le;
      s.lord[i][lt + eqb] = (int16_t)me;
    }
    __syncthreads();
#pragma unroll
    for (int q = 0; q < HPT; q++) {
      int v = tid * HPT + q;
      if (v < NV) {
        int i = s.c1[v], j = s.c2[v];
        int la = s.lgs[i][j - 1], ea = s.lge[i][j - 1], lb = s.lgs[j][i], eb = s.lge[j][i];
        int Lc = s.gs[v] - la - lb;                                   // lower, minus the ones sharing a card
        int Ec = (s.ge[v] - s.gs[v]) - (ea - la) - (eb - lb) + 1;     // equal, the hand itself left out
        s.hs[v] = (int16_t)(2 * Lc + Ec);
      } else {
        s.hs[v] = -1;
      }
    }
    __syncthreads();
  }
};
