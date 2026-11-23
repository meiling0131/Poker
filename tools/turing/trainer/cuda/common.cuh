// Shared pieces of the CUDA solver: cards, hand values, board textures, subset indices, random numbers.
// Everything here matches tools/solver/poker.py exactly (the tests in test_compare.py check it).
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cuda_runtime.h>

#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { \
  fprintf(stderr, "CUDA error %s at %s:%d: %s\n", #x, __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

constexpr int NH = 1326;            // two-card hands
#ifndef PCFR_NB
#define PCFR_NB 24
#endif
constexpr int NB = PCFR_NB;         // buckets per street
constexpr int NE = 8, NPB = 3;      // flop / turn: expected-strength bins x potential bins within each
static_assert(NE * NPB == NB, "flop / turn buckets are expected-strength bins x potential bins");
constexpr int BUCKET_BITS = NB < 16 ? 4 : NB < 32 ? 5 : 6;   // bucket numbers 0..NB (NB: padding) for radix sorts
constexpr int NSL = 6;              // action slots
constexpr int NTEX = 4;             // board texture classes
constexpr int NKEYS = 2880;         // tree.py NKEYS
constexpr int KM = 120;             // tree.py KM (key stride of one texture class)
constexpr int NFLOP = 22100;        // C(52,3)
constexpr int NTURN = 270725;       // C(52,4)
constexpr int NRIVER = 2598960;     // C(52,5)

__host__ __device__ inline uint32_t binom(int n, int k) {
  if (k < 0 || n < k) return 0;
  uint64_t r = 1;
  for (int i = 1; i <= k; i++) r = r * (uint64_t)(n - k + i) / (uint64_t)i;
  return (uint32_t)r;
}

// poker.py numbering: (0,1), (0,2) .. (0,51), (1,2) ..  for a < b
__host__ __device__ inline int hand_index(int a, int b) { return a * 51 - a * (a - 1) / 2 + b - a - 1; }

// colex index of a sorted k-subset (c[0] < c[1] < ...)
__host__ __device__ inline uint32_t colex(const int* c, int k) {
  uint32_t r = 0;
  for (int i = 0; i < k; i++) r += binom(c[i], i + 1);
  return r;
}
__host__ __device__ inline void uncolex(uint32_t idx, int k, int* c) {
  for (int i = k; i >= 1; i--) {
    int x = i - 1;
    while (binom(x + 1, i) <= idx) x++;
    c[i - 1] = x;
    idx -= binom(x, i);
  }
}
__host__ __device__ inline void sort_small(int* c, int k) {
  for (int i = 1; i < k; i++) for (int j = i; j > 0 && c[j - 1] > c[j]; j--) { int t = c[j]; c[j] = c[j - 1]; c[j - 1] = t; }
}

// highest straight in a 13-bit rank mask (bit r = rank r+2), 5 for the wheel, 0 if none (poker.py straight_high)
__host__ __device__ inline int straight_high(uint32_t m) {
  uint32_t e = (m << 1) | ((m >> 12) & 1u);
  for (int j = 9; j >= 0; j--) if (((e >> j) & 0x1Fu) == 0x1Fu) return j + 5;
  return 0;
}
// the k highest rank values (2..14) present in mask, zeros when fewer
__host__ __device__ inline void topk(uint32_t mask, int k, int* out) {
  int n = 0;
  for (int r = 12; r >= 0 && n < k; r--) if (mask >> r & 1u) out[n++] = r + 2;
  while (n < k) out[n++] = 0;
}
__host__ __device__ inline uint32_t enc(int cat, const int* k, int len) {
  uint32_t v = (uint32_t)cat << 20;
  for (int i = 0; i < len; i++) v += (uint32_t)k[i] << (4 * (4 - i));
  return v;
}

// The game's hand value (js best7, poker.py evaluate) of 5..7 cards.
__host__ __device__ inline uint32_t eval_hand(const int* cs, int n) {
  int cnt[13];
  for (int r = 0; r < 13; r++) cnt[r] = 0;
  int sc[4] = {0, 0, 0, 0};
  uint32_t pres = 0, sm[4] = {0, 0, 0, 0};
  for (int i = 0; i < n; i++) {
    int r = cs[i] % 13, s = cs[i] / 13;
    cnt[r]++; sc[s]++; pres |= 1u << r; sm[s] |= 1u << r;
  }
  int fs = 0;
  for (int s = 1; s < 4; s++) if (sc[s] > sc[fs]) fs = s;
  bool flush = sc[fs] >= 5;
  int g0 = -1, g1 = -1, k0 = -1, k1 = -1;            // ranks ordered by count, then rank
  for (int r = 0; r < 13; r++) if (cnt[r]) {
    int k = cnt[r] * 16 + r + 2;
    if (k > k0) { g1 = g0; k1 = k0; g0 = r; k0 = k; }
    else if (k > k1) { g1 = r; k1 = k; }
  }
  int c0 = cnt[g0], c1 = g1 >= 0 ? cnt[g1] : 0;
  int v0 = g0 + 2, v1 = g1 + 2;
  int t[5];
  int sf = flush ? straight_high(sm[fs]) : 0;
  if (sf > 0) { t[0] = sf; t[1] = t[2] = t[3] = t[4] = 0; return enc(8, t, 5); }
  if (c0 == 4) { t[0] = v0; topk(pres & ~(1u << g0), 1, t + 1); t[2] = t[3] = t[4] = 0; return enc(7, t, 5); }
  if (c0 == 3 && c1 >= 2) { t[0] = v0; t[1] = v1; t[2] = t[3] = t[4] = 0; return enc(6, t, 5); }
  if (flush) { topk(sm[fs], 5, t); return enc(5, t, 5); }
  int st = straight_high(pres);
  if (st > 0) { t[0] = st; t[1] = t[2] = t[3] = t[4] = 0; return enc(4, t, 5); }
  if (c0 == 3) { t[0] = v0; topk(pres & ~(1u << g0), 2, t + 1); return enc(3, t, 3); }
  if (c0 == 2 && c1 == 2) { t[0] = v0; t[1] = v1; topk(pres & ~(1u << g0) & ~(1u << g1), 1, t + 2); return enc(2, t, 3); }
  if (c0 == 2) { t[0] = v0; topk(pres & ~(1u << g0), 3, t + 1); return enc(1, t, 4); }
  topk(pres, 5, t);
  return enc(0, t, 5);
}

// 0 paired, 1 three or more of a suit, 2 three ranks within a straight's reach, 3 dry (poker.py texture_class)
__host__ __device__ inline int tex_class(const int* b, int n) {
  int cnt[13];
  for (int r = 0; r < 13; r++) cnt[r] = 0;
  int sc[4] = {0, 0, 0, 0};
  for (int i = 0; i < n; i++) { cnt[b[i] % 13]++; sc[b[i] / 13]++; }
  bool paired = false;
  for (int r = 0; r < 13; r++) paired |= cnt[r] >= 2;
  int mx = sc[0];
  for (int s = 1; s < 4; s++) mx = sc[s] > mx ? sc[s] : mx;
  int p[14];
  p[0] = cnt[12] > 0;
  for (int r = 0; r < 13; r++) p[r + 1] = cnt[r] > 0;
  int run = 0;
  for (int j = 0; j < 10; j++) { int s = p[j] + p[j + 1] + p[j + 2] + p[j + 3] + p[j + 4]; run = s > run ? s : run; }
  int out = 3;
  if (run >= 3) out = 2;
  if (mx >= 3) out = 1;
  if (paired) out = 0;
  return out;
}

__host__ __device__ inline uint64_t splitmix64(uint64_t x) {
  x += 0x9E3779B97F4A7C15ull;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ull;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBull;
  return x ^ (x >> 31);
}
