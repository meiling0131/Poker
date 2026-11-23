// pcfr_hu: heads-up blueprint trainer (preflop on the host, every postflop line on the GPU).
//   pcfr_hu3 precompute --out data/buckets2.bin
//   pcfr_hu3 train --prog out/hu100.prog --buckets data/buckets2.bin --ckpt out/hu100.ckpt [--gpus N]
//                 [--batch 8192] [--minutes 0] [--iters 0] [--report 50] [--save 200] [--seed 1] [--resume]
//   pcfr_hu walktest --prog P --buckets B --boards boards.bin --R r.bin --rng rng.bin --out result.bin
#include "hu_host.cuh"

struct Dev {
  int id = 0, grid = 0;
  Op* prog; int* pf; float* sig; float* rinc; double* sinc; double* ev; uint8_t* boards; int* counter;
  uint8_t* flopB; uint8_t* turnB; int* act_key; int* act_mask; float* rng; float* lineval; int* hcount; float* vsave;
  float* csave;
};
template <class T> static T* upload(const T* src, size_t n) {
  T* d;
  CK(cudaMalloc(&d, std::max<size_t>(1, n) * sizeof(T)));
  if (n) CK(cudaMemcpy(d, src, n * sizeof(T), cudaMemcpyHostToDevice));
  return d;
}
static int fit_grid(const void* fn, int threads, size_t smem, int dev) {
  CK(cudaFuncSetAttribute(fn, cudaFuncAttributeMaxDynamicSharedMemorySize, (int)smem));
  int b = 0;
  CK(cudaOccupancyMaxActiveBlocksPerMultiprocessor(&b, fn, threads, smem));
  if (b < 1) die("kernel does not fit on the GPU");
  cudaDeviceProp prop;
  CK(cudaGetDeviceProperties(&prop, dev));
  return prop.multiProcessorCount * b;
}
static void dev_setup(Dev& D, int id, const HuGame& g, const Buckets& bk, int maxBoards, size_t rows) {
  D.id = id;
  CK(cudaSetDevice(id));
  D.prog = upload(g.ops.data(), g.ops.size());
  D.pf = upload(g.pf.data(), g.pf.size());
  D.act_key = upload(g.act_key.data(), g.act_key.size());
  D.act_mask = upload(g.act_mask.data(), g.act_mask.size());
  D.flopB = upload(bk.flop.data(), bk.flop.size());
  D.turnB = upload(bk.turn.data(), bk.turn.size());
  CK(cudaMalloc(&D.sig, std::max<size_t>(1, (size_t)g.nact * NTEX * NB * NSL) * 4));
  CK(cudaMalloc(&D.rinc, std::max<size_t>(1, rows * NSL) * 4));
  CK(cudaMalloc(&D.sinc, std::max<size_t>(1, rows * NSL) * 8));
  CK(cudaMalloc(&D.ev, 16));
  CK(cudaMalloc(&D.boards, (size_t)std::max(1, maxBoards) * 5));
  CK(cudaMalloc(&D.counter, 4));
  CK(cudaMalloc(&D.rng, (size_t)g.nlines * 2 * NH * 4));
  CK(cudaMalloc(&D.lineval, (size_t)g.nlines * 2 * NH * 4));
  CK(cudaMalloc(&D.hcount, NH * 4));
  D.grid = fit_grid((const void*)walk_kernel, WNT, sizeof(WalkSM), id);
  CK(cudaMalloc(&D.vsave, (size_t)D.grid * 4 * WNP * 4));
  CK(cudaMalloc(&D.csave, (size_t)D.grid * 2 * 2 * NB * WM * 4));
}
static void launch_walk(Dev& D, const HuGame& g, const int* rthr, int nboards, size_t rows, uint8_t* dbgb) {
  CK(cudaSetDevice(D.id));
  CK(cudaMemsetAsync(D.rinc, 0, rows * NSL * 4));
  CK(cudaMemsetAsync(D.sinc, 0, rows * NSL * 8));
  CK(cudaMemsetAsync(D.ev, 0, 16));
  CK(cudaMemsetAsync(D.counter, 0, 4));
  CK(cudaMemsetAsync(D.lineval, 0, (size_t)g.nlines * 2 * NH * 4));
  CK(cudaMemsetAsync(D.hcount, 0, NH * 4));
  WalkParams P;
  P.prog = D.prog; P.nops = g.nops; P.pf = D.pf; P.sig = D.sig; P.rinc = D.rinc; P.sinc = D.sinc; P.ev = D.ev;
  P.boards = D.boards; P.nboards = nboards; P.counter = D.counter; P.flopB = D.flopB; P.turnB = D.turnB;
  P.rng = D.rng; P.lineval = D.lineval; P.hcount = D.hcount; P.vsave = D.vsave; P.csave = D.csave; P.dbgb = dbgb;
  for (int i = 0; i < NB - 1; i++) P.rthr[i] = rthr[i];
  walk_kernel<<<std::min(D.grid, std::max(1, nboards)), WNT, sizeof(WalkSM)>>>(P);
  CK(cudaGetLastError());
}

template <class T> static std::vector<T> read_all(const std::string& path, size_t n) {
  std::vector<T> v(n);
  FILE* f = open_or_die(path, "rb");
  rd(f, v.data(), n);
  fclose(f);
  return v;
}

static int cmd_walktest() {
  init_hands();
  const HuGame g = load_hu(arg("prog"));
  const Buckets bk = load_buckets(arg("buckets"));
  FILE* f = open_or_die(arg("boards"), "rb");
  int n;
  rd(f, &n, 1);
  std::vector<int> bd((size_t)n * 5);
  rd(f, bd.data(), bd.size());
  fclose(f);
  const size_t rows = (size_t)g.nact * NTEX * NB;
  const auto R = read_all<float>(arg("R"), rows * NSL);
  const auto rng = read_all<float>(arg("rng"), (size_t)g.nlines * 2 * NH);
  Dev D;
  dev_setup(D, 0, g, bk, n, rows);
  std::vector<uint8_t> b8(bd.begin(), bd.end());
  CK(cudaMemcpy(D.boards, b8.data(), b8.size(), cudaMemcpyHostToDevice));
  CK(cudaMemcpy(D.rng, rng.data(), rng.size() * 4, cudaMemcpyHostToDevice));
  float* dR = upload(R.data(), R.size());
  if (g.nact > 0) sig_kernel<<<nblk((size_t)g.nact * NTEX * NB), 256>>>(dR, D.act_key, D.act_mask, g.nact, D.sig);
  uint8_t* dbg;
  CK(cudaMalloc(&dbg, (size_t)n * 3 * NH)); CK(cudaMemset(dbg, 0xFF, (size_t)n * 3 * NH));
  int rthr[NB - 1];
  river_thresholds(bk.er, rthr);
  CK(cudaDeviceSynchronize());
  const double t0 = now_s();
  launch_walk(D, g, rthr, n, rows, dbg);
  CK(cudaDeviceSynchronize());
  const double dt = now_s() - t0;
  logf("walktest: %d boards in %.3fs (%.1f boards/s, grid %d, %zu B shared per block)", n, dt, n / dt, D.grid, sizeof(WalkSM));
  std::vector<float> rinc(rows * NSL), lv((size_t)g.nlines * 2 * NH);
  std::vector<double> sinc(rows * NSL), ev(2);
  std::vector<int> hc(NH);
  std::vector<uint8_t> B((size_t)n * 3 * NH);
  CK(cudaMemcpy(rinc.data(), D.rinc, rinc.size() * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(sinc.data(), D.sinc, sinc.size() * 8, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(ev.data(), D.ev, 16, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(lv.data(), D.lineval, lv.size() * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(hc.data(), D.hcount, NH * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(B.data(), dbg, B.size(), cudaMemcpyDeviceToHost));
  FILE* o = open_or_die(arg("out"), "wb");
  wr(o, rinc.data(), rinc.size()); wr(o, sinc.data(), sinc.size()); wr(o, lv.data(), lv.size());
  wr(o, hc.data(), hc.size()); wr(o, ev.data(), 2); wr(o, B.data(), B.size());
  fclose(o);
  return 0;
}

// ---- checkpoints: postflop regrets / strategy sums, preflop regrets / strategy sums
static void save_ckpt(const std::string& path, const HuGame& g, size_t rows, int t, long long boards, double elapsed,
                      const float* dR, const double* dS, const Preflop& pre) {
  std::vector<float> R(rows * NSL);
  std::vector<double> S(rows * NSL);
  CK(cudaSetDevice(0));
  CK(cudaMemcpy(R.data(), dR, R.size() * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(S.data(), dS, S.size() * 8, cudaMemcpyDeviceToHost));
  const std::string tmp = path + ".tmp";
  FILE* f = open_or_die(tmp, "wb");
  const int ver = 2, h[4] = {(int)rows, t, g.nact, g.npn};
  wr(f, "PCK2", 4); wr(f, &ver, 1); wr(f, h, 4); wr(f, &boards, 1); wr(f, &elapsed, 1);
  wr(f, R.data(), R.size()); wr(f, S.data(), S.size()); wr(f, pre.R.data(), pre.R.size()); wr(f, pre.S.data(), pre.S.size());
  fclose(f);
  if (rename(tmp.c_str(), path.c_str())) die("cannot write", path);
}
static bool load_ckpt(const std::string& path, const HuGame& g, size_t rows, int& t, long long& boards, double& elapsed,
                      std::vector<float>& R, std::vector<double>& S, Preflop& pre) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  char magic[4]; int ver, h[4];
  rd(f, magic, 4); rd(f, &ver, 1); rd(f, h, 4);
  if (memcmp(magic, "PCK2", 4) || ver != 2 || (size_t)h[0] != rows || h[2] != g.nact || h[3] != g.npn)
    die("checkpoint does not match this game", path);
  t = h[1];
  rd(f, &boards, 1); rd(f, &elapsed, 1);
  R.resize(rows * NSL); S.resize(rows * NSL);
  rd(f, R.data(), R.size()); rd(f, S.data(), S.size()); rd(f, pre.R.data(), pre.R.size()); rd(f, pre.S.data(), pre.S.size());
  fclose(f);
  return true;
}

// the small blind's average opening strategy, weighted by combos (a quick look at preflop)
static void sb_open(const Preflop& pre, double out[4]) {
  for (int a = 0; a < 4; a++) out[a] = 0;
  for (int h = 0; h < NH; h++) {
    const double* s = &pre.S[(size_t)hclass[h] * 4];
    double tot = s[0] + s[1] + s[2] + s[3];
    for (int a = 0; a < 4; a++) out[a] += tot > 0 ? s[a] / tot / NH : 0.25 / NH;
  }
}

// ---- precompute: exact bucket tables for every flop and turn (every runout enumerated), and the river edges
static double quantile_hist(const std::vector<ull>& h, double den, double q) {
  ull N = 0;
  for (ull c : h) N += c;
  if (N == 0) return 0.0;
  const double pos = q * (double)(N - 1);
  const ull lo = (ull)std::floor(pos), hi = (ull)std::ceil(pos);
  auto at = [&](ull i) {
    ull c = 0;
    for (size_t v = 0; v < h.size(); v++) { c += h[v]; if (c > i) return (double)v; }
    return (double)(h.size() - 1);
  };
  const double xl = at(lo), xh = at(hi);
  return (xl + (xh - xl) * (pos - (double)lo)) / den;
}

// strength bins: more of them among strong hands (bigger pots ride on telling them apart)
static const double ECUT[NE - 1] = {0.22, 0.42, 0.58, 0.71, 0.81, 0.89, 0.95};
static double river_cut(int i) { return 1.0 - std::pow(1.0 - (i + 1.0) / NB, 1.2); }

static int cmd_precompute() {
  const std::string out = arg("out", "data/buckets2.bin");
  CK(cudaSetDevice(0));
  cudaDeviceProp prop;
  CK(cudaGetDeviceProperties(&prop, 0));
  logf("precompute on %s: flop / turn %d strength x %d potential buckets, river %d", prop.name, NE, NPB, NB);
  const double t0 = now_s();
  int *flopAcc, *turnAcc;
  ull* histR;
  CK(cudaMalloc(&flopAcc, (size_t)NFLOP * NH * 4)); CK(cudaMemset(flopAcc, 0, (size_t)NFLOP * NH * 4));
  CK(cudaMalloc(&turnAcc, (size_t)NTURN * NH * 4)); CK(cudaMemset(turnAcc, 0, (size_t)NTURN * NH * 4));
  CK(cudaMalloc(&histR, 1981 * 8)); CK(cudaMemset(histR, 0, 1981 * 8));
  const int g5 = fit_grid((const void*)river_pass, PNT, sizeof(PreSM<5>), 0);
  river_pass<<<g5, PNT, sizeof(PreSM<5>)>>>(flopAcc, turnAcc, histR);
  CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
  logf("  %d river boards in %.1fs", NRIVER, now_s() - t0);

  const double denF = 1081.0 * 1980.0, denT = 46.0 * 1980.0;
  const size_t nF = 1081 * 1980 + 1, nT = 46 * 1980 + 1;
  ull *hF, *hT;
  CK(cudaMalloc(&hF, nF * 8)); CK(cudaMemset(hF, 0, nF * 8));
  CK(cudaMalloc(&hT, nT * 8)); CK(cudaMemset(hT, 0, nT * 8));
  acc_hist<<<8192, 256>>>(flopAcc, NFLOP, 3, hF);
  acc_hist<<<65536, 256>>>(turnAcc, NTURN, 4, hT);
  CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
  std::vector<ull> HF(nF), HT(nT), HR(1981);
  CK(cudaMemcpy(HF.data(), hF, nF * 8, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(HT.data(), hT, nT * 8, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(HR.data(), histR, 1981 * 8, cudaMemcpyDeviceToHost));
  std::vector<double> ef(NE - 1), et(NE - 1), er(NB - 1), gf(NE * (NPB - 1)), gt(NE * (NPB - 1));
  for (int i = 0; i < NE - 1; i++) { ef[i] = quantile_hist(HF, denF, ECUT[i]); et[i] = quantile_hist(HT, denT, ECUT[i]); }
  for (int i = 0; i < NB - 1; i++) er[i] = quantile_hist(HR, 1980.0, river_cut(i));

  ull* hG;
  CK(cudaMalloc(&hG, (size_t)NE * NGB * 8));
  std::vector<ull> HG((size_t)NE * NGB);
  for (int k = 3; k <= 4; k++) {
    EdgesE E;
    for (int i = 0; i < NE - 1; i++) E.e[i] = k == 3 ? ef[i] : et[i];
    CK(cudaMemset(hG, 0, (size_t)NE * NGB * 8));
    if (k == 3) {
      const int g = fit_grid((const void*)gain_hist<3>, PNT, sizeof(PreSM<3>), 0);
      gain_hist<3><<<g, PNT, sizeof(PreSM<3>)>>>(flopAcc, E, denF, hG);
    } else {
      const int g = fit_grid((const void*)gain_hist<4>, PNT, sizeof(PreSM<4>), 0);
      gain_hist<4><<<g, PNT, sizeof(PreSM<4>)>>>(turnAcc, E, denT, hG);
    }
    CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    CK(cudaMemcpy(HG.data(), hG, HG.size() * 8, cudaMemcpyDeviceToHost));
    std::vector<double>& g = k == 3 ? gf : gt;
    for (int eb = 0; eb < NE; eb++) {
      std::vector<ull> one(HG.begin() + (size_t)eb * NGB, HG.begin() + (size_t)(eb + 1) * NGB);
      for (int i = 0; i < NPB - 1; i++) g[eb * (NPB - 1) + i] = quantile_hist(one, GRES, (i + 1.0) / NPB) - 1.0;
    }
  }
  for (int k = 0; k < 2; k++) {
    const auto& e = k ? et : ef;
    const auto& g = k ? gt : gf;
    std::string line = k ? "  turn " : "  flop ";
    char buf[64];
    for (int eb = 0; eb < NE; eb++) {
      snprintf(buf, sizeof buf, "%s[", eb ? " | " : "");
      line += buf;
      for (int i = 0; i < NPB - 1; i++) { snprintf(buf, sizeof buf, "%s%+.3f", i ? " " : "", g[eb * (NPB - 1) + i]); line += buf; }
      line += "]";
      if (eb < NE - 1) { snprintf(buf, sizeof buf, " %.3f", e[eb]); line += buf; }
    }
    logf("%s", line.c_str());
  }
  {
    std::string line = "  river";
    char buf[32];
    for (double x : er) { snprintf(buf, sizeof buf, " %.3f", x); line += buf; }
    logf("%s", line.c_str());
  }

  uint8_t *fT, *tT;
  CK(cudaMalloc(&fT, (size_t)NFLOP * NH)); CK(cudaMemset(fT, 0xFF, (size_t)NFLOP * NH));
  CK(cudaMalloc(&tT, (size_t)NTURN * NH)); CK(cudaMemset(tT, 0xFF, (size_t)NTURN * NH));
  Edges2 E2f, E2t;
  for (int i = 0; i < NE - 1; i++) { E2f.e[i] = ef[i]; E2t.e[i] = et[i]; }
  for (int eb = 0; eb < NE; eb++)
    for (int i = 0; i < NPB - 1; i++) { E2f.g[eb][i] = gf[eb * (NPB - 1) + i]; E2t.g[eb][i] = gt[eb * (NPB - 1) + i]; }
  const int g3 = fit_grid((const void*)now_pass2<3>, PNT, sizeof(PreSM<3>), 0);
  now_pass2<3><<<g3, PNT, sizeof(PreSM<3>)>>>(flopAcc, E2f, denF, fT);
  const int g4 = fit_grid((const void*)now_pass2<4>, PNT, sizeof(PreSM<4>), 0);
  now_pass2<4><<<g4, PNT, sizeof(PreSM<4>)>>>(turnAcc, E2t, denT, tT);
  CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
  std::vector<uint8_t> F((size_t)NFLOP * NH), T((size_t)NTURN * NH);
  CK(cudaMemcpy(F.data(), fT, F.size(), cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(T.data(), tT, T.size(), cudaMemcpyDeviceToHost));
  for (int k = 0; k < 2; k++) {                       // every bucket's share of all (board, hand) pairs
    const auto& tab = k ? T : F;
    std::vector<double> cnt(NB + 1, 0.0);
    for (uint8_t b : tab) cnt[b == 255 ? NB : std::min<int>(b, NB)] += 1;
    double tot = 0;
    for (int b = 0; b < NB; b++) tot += cnt[b];
    std::string line = k ? "  turn shares %" : "  flop shares %";
    char buf[16];
    for (int b = 0; b < NB; b++) { snprintf(buf, sizeof buf, " %.1f", 100 * cnt[b] / tot); line += buf; }
    logf("%s", line.c_str());
  }
  FILE* f = open_or_die(out + ".tmp", "wb");
  const int ver = 2, dims[3] = {NE, NPB, NB};
  wr(f, "PBKT", 4); wr(f, &ver, 1); wr(f, dims, 3);
  for (const auto* v : {&ef, &gf, &et, &gt, &er}) wr(f, v->data(), v->size());
  wr(f, F.data(), F.size()); wr(f, T.data(), T.size());
  fclose(f);
  rename((out + ".tmp").c_str(), out.c_str());
  logf("wrote %s in %.1fs", out.c_str(), now_s() - t0);
  return 0;
}

static int cmd_train() {
  init_hands();
  const HuGame g = load_hu(arg("prog"));
  const Buckets bk = load_buckets(arg("buckets"));
  const std::string ckpt = arg("ckpt");
  if (ckpt.empty()) die("--ckpt is required");
  int ndev = 0;
  CK(cudaGetDeviceCount(&ndev));
  const int G = has("gpus") ? std::min(ndev, atoi(arg("gpus").c_str())) : ndev;
  const long batch = atol(arg("batch", "8192").c_str());
  const double minutes = atof(arg("minutes", "0").c_str());
  const long iters = atol(arg("iters", "0").c_str());
  const int report = std::max(1, atoi(arg("report", "50").c_str())), save = std::max(1, atoi(arg("save", "200").c_str()));
  const uint64_t seed = strtoull(arg("seed", "1").c_str(), nullptr, 10);
  const size_t rows = (size_t)g.nact * NTEX * NB, nv = rows * NSL, nsig = (size_t)g.nact * NTEX * NB * NSL;
  const size_t nlv = (size_t)g.nlines * 2 * NH;
  int rthr[NB - 1];
  river_thresholds(bk.er, rthr);

  std::vector<Dev> D(G);
  std::vector<int> nb(G);
  for (int i = 0; i < G; i++) nb[i] = (int)(batch / G + (i < batch % G ? 1 : 0));
  for (int i = 0; i < G; i++) dev_setup(D[i], i, g, bk, nb[i], rows);
  for (int i = 1; i < G; i++) {
    int can = 0;
    CK(cudaDeviceCanAccessPeer(&can, 0, i));
    if (can) { CK(cudaSetDevice(0)); cudaDeviceEnablePeerAccess(i, 0); CK(cudaSetDevice(i)); cudaDeviceEnablePeerAccess(0, 0); cudaGetLastError(); }
  }
  CK(cudaSetDevice(0));
  float *R, *stR, *prev, *stL;
  double *S, *stS, *stE, *dmoved;
  int* stH;
  CK(cudaMalloc(&R, nv * 4)); CK(cudaMemset(R, 0, nv * 4));
  CK(cudaMalloc(&S, nv * 8)); CK(cudaMemset(S, 0, nv * 8));
  CK(cudaMalloc(&stR, nv * 4)); CK(cudaMalloc(&stS, nv * 8)); CK(cudaMalloc(&stE, 16));
  CK(cudaMalloc(&stL, nlv * 4)); CK(cudaMalloc(&stH, NH * 4));
  CK(cudaMalloc(&prev, nv * 4)); CK(cudaMemset(prev, 0, nv * 4));
  CK(cudaMalloc(&dmoved, 8));

  Preflop pre(g);
  int t = 0;
  long long boards = 0;
  double elapsed0 = 0;
  if (has("resume")) {
    std::vector<float> hR; std::vector<double> hS;
    if (load_ckpt(ckpt, g, rows, t, boards, elapsed0, hR, hS, pre)) {
      CK(cudaMemcpy(R, hR.data(), nv * 4, cudaMemcpyHostToDevice));
      CK(cudaMemcpy(S, hS.data(), nv * 8, cudaMemcpyHostToDevice));
      logf("resumed at iteration %d (%.3fG boards, %.0f min trained)", t, boards / 1e9, elapsed0 / 60);
    }
  }
  if (nv > 0) sig_kernel<<<nblk(nsig / NSL), 256>>>(R, D[0].act_key, D[0].act_mask, g.nact, D[0].sig);
  CK(cudaDeviceSynchronize());
  for (int i = 1; i < G && nv > 0; i++) CK(cudaMemcpyPeer(D[i].sig, i, D[0].sig, 0, nsig * 4));
  cudaDeviceProp prop;
  CK(cudaGetDeviceProperties(&prop, 0));
  logf("%s: %gBB · %d preflop nodes, %d lines, %d postflop act nodes, %d ops · %d x %s, %d blocks/GPU, batch %ld",
       ckpt.c_str(), g.stack, g.npn, g.nlines, g.nact, g.nops, G, prop.name, D[0].grid, batch);

  std::vector<float> rngv, lineval(nlv);
  std::vector<int> hcount(NH);
  const double t0 = now_s();
  double tlast = t0;
  long long blast = boards;
  int itlast = t;
  bool have_prev = false;
  for (;;) {
    if (iters > 0 && t >= iters) break;
    if (minutes > 0 && elapsed0 + (now_s() - t0) >= minutes * 60) break;
    t++;
    pre.strategy();
    pre.forward();
    pre.line_ranges(rngv);
    const uint64_t st = splitmix64(seed * 0x100000001B3ull + (uint64_t)t * 0x9E3779B97F4A7C15ull);
    long long first = 0;
    for (int i = 0; i < G; i++) {
      CK(cudaSetDevice(i));
      CK(cudaMemcpy(D[i].rng, rngv.data(), nlv * 4, cudaMemcpyHostToDevice));
      sample_boards<<<nblk(nb[i]), 256>>>(D[i].boards, nb[i], st, first);
      first += nb[i];
      launch_walk(D[i], g, rthr, nb[i], rows, nullptr);
    }
    for (int i = 0; i < G; i++) { CK(cudaSetDevice(i)); CK(cudaDeviceSynchronize()); }
    CK(cudaSetDevice(0));
    for (int i = 1; i < G; i++) {
      CK(cudaMemcpyPeer(stR, 0, D[i].rinc, i, nv * 4));
      CK(cudaMemcpyPeer(stS, 0, D[i].sinc, i, nv * 8));
      CK(cudaMemcpyPeer(stL, 0, D[i].lineval, i, nlv * 4));
      CK(cudaMemcpyPeer(stH, 0, D[i].hcount, i, NH * 4));
      if (nv > 0) add_f32<<<nblk(nv), 256>>>(D[0].rinc, stR, nv);
      if (nv > 0) add_f64<<<nblk(nv), 256>>>(D[0].sinc, stS, nv);
      add_f32<<<nblk(nlv), 256>>>(D[0].lineval, stL, nlv);
      add_i32<<<nblk(NH), 256>>>(D[0].hcount, stH, NH);
    }
    const double tt = t - 1;
    const float pos = (float)(std::pow(tt, 1.5) / (std::pow(tt, 1.5) + 1.0));
    const double sg = std::pow(tt / (tt + 1.0), 2.0);
    if (nv > 0) {
      update_kernel<<<nblk(nv), 256>>>(R, S, D[0].rinc, D[0].sinc, nv, pos, 0.5f, sg, t == 1);
      sig_kernel<<<nblk(nsig / NSL), 256>>>(R, D[0].act_key, D[0].act_mask, g.nact, D[0].sig);
    }
    CK(cudaMemcpy(lineval.data(), D[0].lineval, nlv * 4, cudaMemcpyDeviceToHost));
    CK(cudaMemcpy(hcount.data(), D[0].hcount, NH * 4, cudaMemcpyDeviceToHost));
    for (int i = 1; i < G && nv > 0; i++) CK(cudaMemcpyPeer(D[i].sig, i, D[0].sig, 0, nsig * 4));
    pre.backward(lineval, hcount, t);
    boards += batch;
    const bool last = (iters > 0 && t >= iters) || (minutes > 0 && elapsed0 + (now_s() - t0) >= minutes * 60);
    if (t % report == 0 || last) {
      CK(cudaMemset(dmoved, 0, 8));
      if (rows > 0) moved_kernel<<<nblk(rows), 256>>>(S, prev, rows, dmoved);
      double dm = 0;
      CK(cudaMemcpy(&dm, dmoved, 8, cudaMemcpyDeviceToHost));
      const double moved = have_prev ? dm / (double)rows : NAN;
      have_prev = true;
      double op[4];
      sb_open(pre, op);
      const double now = now_s();
      logf("  it %d · SB EV %+.4fBB · SB fold %.0f%% limp %.0f%% raise %.0f%% jam %.0f%% · moved %.5f · %.3fs/it · %.1fk boards/s · %.0f min",
           t, pre.ev_sb, 100 * op[0], 100 * op[1], 100 * op[2], 100 * op[3], moved, (now - tlast) / std::max(1, t - itlast),
           (boards - blast) / (now - tlast) / 1e3, (elapsed0 + now - t0) / 60);
      tlast = now; blast = boards; itlast = t;
    }
    if (t % save == 0) save_ckpt(ckpt, g, rows, t, boards, elapsed0 + now_s() - t0, R, S, pre);
  }
  save_ckpt(ckpt, g, rows, t, boards, elapsed0 + now_s() - t0, R, S, pre);
  logf("done: %d iterations, %.3fG boards, saved %s", t, boards / 1e9, ckpt.c_str());
  return 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: pcfr_hu3 precompute|train|walktest [--options]\n");
    return 2;
  }
  const std::string cmd = argv[1];
  parse_args(argc, argv, 2);
  if (cmd == "precompute") return cmd_precompute();
  if (cmd == "train") return cmd_train();
  if (cmd == "walktest") return cmd_walktest();
  fprintf(stderr, "unknown command %s\n", cmd.c_str());
  return 2;
}
