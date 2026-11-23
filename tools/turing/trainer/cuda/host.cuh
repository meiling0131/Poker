// Host-side helpers: arguments, logging, files, the compiled tree, the bucket tables, and the small training kernels.
#pragma once
#include "walk.cuh"
#include "precompute.cuh"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdarg>
#include <cstring>
#include <ctime>
#include <map>
#include <string>
#include <vector>

typedef unsigned long long ull;

static std::map<std::string, std::string> ARGS;
static void parse_args(int argc, char** argv, int start) {
  for (int i = start; i < argc; i++) {
    std::string a = argv[i];
    if (a.rfind("--", 0) != 0) continue;
    std::string k = a.substr(2);
    if (i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) ARGS[k] = argv[++i];
    else ARGS[k] = "1";
  }
}
static std::string arg(const char* k, const char* def = "") { auto it = ARGS.find(k); return it == ARGS.end() ? def : it->second; }
static bool has(const char* k) { return ARGS.count(k) > 0; }

static void logf(const char* fmt, ...) {
  time_t now = time(nullptr);
  char ts[16];
  strftime(ts, sizeof ts, "%H:%M:%S", localtime(&now));
  printf("%s ", ts);
  va_list ap;
  va_start(ap, fmt);
  vprintf(fmt, ap);
  va_end(ap);
  printf("\n");
  fflush(stdout);
}
[[noreturn]] static void die(const char* msg, const std::string& what = "") {
  fprintf(stderr, "error: %s %s\n", msg, what.c_str());
  exit(1);
}
static double now_s() {
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

static FILE* open_or_die(const std::string& p, const char* mode) {
  FILE* f = fopen(p.c_str(), mode);
  if (!f) die("cannot open", p);
  return f;
}
template <class T> static void rd(FILE* f, T* dst, size_t n) { if (fread(dst, sizeof(T), n, f) != n) die("short read"); }
template <class T> static void wr(FILE* f, const T* src, size_t n) { if (fwrite(src, sizeof(T), n, f) != n) die("short write"); }

// ---- the compiled tree (export_tree.py)
struct Prog {
  int nops = 0, nact = 0, nkeys = 0, npf = 0, init = 0;
  float pot = 0, stack = 0;
  std::vector<int> kbase, act_key, act_mask, pf;
  std::vector<Op> ops;
  std::vector<float> rng0, rng1;
};
static Prog load_prog(const std::string& path) {
  FILE* f = open_or_die(path, "rb");
  char magic[4]; int ver;
  rd(f, magic, 4); rd(f, &ver, 1);
  if (memcmp(magic, "PCFR", 4) || ver != 1) die("not a program file", path);
  Prog p;
  int h[4]; rd(f, h, 4);
  p.nops = h[0]; p.nact = h[1]; p.nkeys = h[2]; p.npf = h[3];
  rd(f, &p.pot, 1); rd(f, &p.stack, 1); rd(f, &p.init, 1);
  p.kbase.resize(p.nkeys); rd(f, p.kbase.data(), p.nkeys);
  p.act_key.resize(p.nact); rd(f, p.act_key.data(), p.nact);
  p.act_mask.resize(p.nact); rd(f, p.act_mask.data(), p.nact);
  p.pf.resize(p.npf); rd(f, p.pf.data(), p.npf);
  p.ops.resize(p.nops); rd(f, p.ops.data(), p.nops);
  p.rng0.resize(NH); rd(f, p.rng0.data(), NH);
  p.rng1.resize(NH); rd(f, p.rng1.data(), NH);
  fclose(f);
  return p;
}

// ---- exact bucket tables (precompute): flop / turn bucket = NPB * bin(expected strength) + bin(potential within that
// bin), potential = expected minus current strength; river bucket = bin(strength)
struct Buckets {
  std::vector<double> ef, gf, et, gt, er;   // flop and turn: NE-1 strength edges, NE x (NPB-1) potential edges; river NB-1
  std::vector<uint8_t> flop, turn;
};
static Buckets load_buckets(const std::string& path) {
  FILE* f = open_or_die(path, "rb");
  char magic[4]; int ver, dims[3];
  rd(f, magic, 4); rd(f, &ver, 1);
  if (memcmp(magic, "PBKT", 4) || ver != 2) die("not a version 2 bucket file", path);
  rd(f, dims, 3);
  if (dims[0] != NE || dims[1] != NPB || dims[2] != NB) die("the bucket file was made for other bucket counts", path);
  Buckets b;
  b.ef.resize(NE - 1); b.gf.resize(NE * (NPB - 1)); b.et.resize(NE - 1); b.gt.resize(NE * (NPB - 1)); b.er.resize(NB - 1);
  for (auto* v : {&b.ef, &b.gf, &b.et, &b.gt, &b.er}) rd(f, v->data(), v->size());
  b.flop.resize((size_t)NFLOP * NH); rd(f, b.flop.data(), b.flop.size());
  b.turn.resize((size_t)NTURN * NH); rd(f, b.turn.data(), b.turn.size());
  fclose(f);
  return b;
}
// river bucket = number of edges below strength k / 1980, as thresholds on k
static void river_thresholds(const std::vector<double>& e, int* thr) {
  for (int i = 0; i < NB - 1; i++) {
    int k = std::max(0, (int)std::floor(e[i] * 1980.0) - 2);
    while (k <= 1981 && !((double)k / 1980.0 > e[i])) k++;
    thr[i] = k;
  }
}

// ---- training kernels
// board i of an iteration depends only on (seed, iteration, i): any number of GPUs deals the same boards
__global__ void sample_boards(uint8_t* out, int n, uint64_t seed, long long first) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= n) return;
  uint64_t st = splitmix64(seed ^ ((uint64_t)(first + i) * 0xD1B54A32D192ED03ull));
  uint64_t used = 0;
  for (int k = 0; k < 5; k++) {
    int c;
    do { st = splitmix64(st); c = (int)(st % 52ull); } while (used >> c & 1ull);
    used |= 1ull << c;
    out[(size_t)i * 5 + k] = (uint8_t)c;
  }
}

// regret matching per (act node, texture, bucket), with the node's own action mask (solve.py Solver.strategy)
__global__ void sig_kernel(const float* R, const int* act_key, const int* act_mask, int nact, float* sig) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= nact * NTEX * NB) return;
  const int a = i / (NTEX * NB), r = i % (NTEX * NB), tex = r / NB, b = r % NB;
  const size_t row = ((size_t)(act_key[a] * NTEX + tex) * NB + b) * NSL;
  const int mask = act_mask[a];
  float reg[NSL], tot = 0.f;
  int cnt = 0;
  for (int sl = 0; sl < NSL; sl++) {
    const bool m = mask >> sl & 1;
    reg[sl] = m ? fmaxf(R[row + sl], 0.f) : 0.f;
    tot += reg[sl]; cnt += m;
  }
  float* o = sig + (size_t)i * NSL;
  for (int sl = 0; sl < NSL; sl++) o[sl] = tot > 0.f ? reg[sl] / tot : ((mask >> sl & 1) ? 1.f / cnt : 0.f);
}

// DCFR (solve.py Solver.step): discount the old regrets and strategy sums, then add this iteration's
__global__ void update_kernel(float* R, double* S, const float* rinc, const double* sinc, size_t n, float pos, float neg,
                              double sg, int first) {
  const size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= n) return;
  float r = R[i];
  double s = S[i];
  if (!first) { r *= r > 0.f ? pos : neg; s *= sg; }
  R[i] = r + rinc[i];
  S[i] = s + sinc[i];
}
__global__ void add_f32(float* a, const float* b, size_t n) { size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x; if (i < n) a[i] += b[i]; }
__global__ void add_i32(int* a, const int* b, size_t n) { size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x; if (i < n) a[i] += b[i]; }
__global__ void add_f64(double* a, const double* b, size_t n) { size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x; if (i < n) a[i] += b[i]; }

// average strategy per row, and how far it moved since the last report (solve.py "strategy moved")
__global__ void moved_kernel(const double* S, float* prev, size_t rows, double* out) {
  const size_t r = (size_t)blockIdx.x * blockDim.x + threadIdx.x;
  double d = 0;
  if (r < rows) {
    double tot = 0;
    for (int sl = 0; sl < NSL; sl++) tot += S[r * NSL + sl];
    for (int sl = 0; sl < NSL; sl++) {
      const float a = tot > 0 ? (float)(S[r * NSL + sl] / tot) : 0.f;
      d += fabsf(a - prev[r * NSL + sl]);
      prev[r * NSL + sl] = a;
    }
  }
  for (int o = 16; o > 0; o >>= 1) d += __shfl_down_sync(0xffffffffu, d, o);
  if ((threadIdx.x & 31) == 0) atomicAdd(out, d);
}

static inline unsigned nblk(size_t n, int t = 256) { return (unsigned)((n + t - 1) / t); }
