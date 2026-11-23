// Heads-up game on the host: the compiled program (hu_export.py) and the preflop CFR.
//
// Preflop is solved here with every hand separate (strategy per 169 classes, values per 1326 hands): each
// iteration turns the preflop strategy into every line's ranges (what the GPU walk starts from), and once the walk
// has returned every hand's value at each line's root, walks the preflop tree back up for the regrets.
#pragma once
#include "host.cuh"

struct HuLine { int kind; float pot, behind; int leaf; };          // kind 0 flop, 1 all-in showdown
struct PAct { int kind, idx; };                                     // kind -1 none, 0 node, 1 leaf
struct PNodeH { int player; float c0, c1; PAct a[4]; };             // actions fold, call, raise, all-in
struct PLeaf { int kind; float c0, c1; int folder, line; };         // kind 0 fold, 1 show, 2 flop

struct HuGame {
  float stack = 0;
  int nops = 0, nact = 0, npf = 0, nlines = 0, npn = 0, nleaves = 0;
  std::vector<HuLine> lines;
  std::vector<int> act_mask, act_line, pf, act_key;
  std::vector<Op> ops;
  std::vector<PNodeH> pn;
  std::vector<PLeaf> leaves;
};

static HuGame load_hu(const std::string& path) {
  FILE* f = open_or_die(path, "rb");
  char magic[4]; int ver;
  rd(f, magic, 4); rd(f, &ver, 1);
  if (memcmp(magic, "PCF2", 4) || ver != 2) die("not a heads-up program file", path);
  HuGame g;
  int h[5]; rd(f, h, 5);
  g.nops = h[0]; g.nact = h[1]; g.npf = h[2]; g.nlines = h[3]; g.npn = h[4];
  rd(f, &g.stack, 1); rd(f, &g.nleaves, 1);
  for (int i = 0; i < g.nlines; i++) {
    HuLine l; rd(f, &l.kind, 1); rd(f, &l.pot, 1); rd(f, &l.behind, 1); rd(f, &l.leaf, 1);
    g.lines.push_back(l);
  }
  g.act_mask.resize(g.nact); rd(f, g.act_mask.data(), g.nact);
  g.act_line.resize(g.nact); rd(f, g.act_line.data(), g.nact);
  g.pf.resize(g.npf); rd(f, g.pf.data(), g.npf);
  g.ops.resize(g.nops); rd(f, g.ops.data(), g.nops);
  for (int i = 0; i < g.npn; i++) {
    PNodeH n; rd(f, &n.player, 1); rd(f, &n.c0, 1); rd(f, &n.c1, 1);
    for (int a = 0; a < 4; a++) { rd(f, &n.a[a].kind, 1); rd(f, &n.a[a].idx, 1); }
    g.pn.push_back(n);
  }
  for (int i = 0; i < g.nleaves; i++) {
    PLeaf l; rd(f, &l.kind, 1); rd(f, &l.c0, 1); rd(f, &l.c1, 1); rd(f, &l.folder, 1); rd(f, &l.line, 1);
    g.leaves.push_back(l);
  }
  fclose(f);
  g.act_key.resize(g.nact);
  for (int i = 0; i < g.nact; i++) g.act_key[i] = i;               // every act node is its own information set
  return g;
}

// ---- cards on the host (same numbering as the device)
static int hcard[NH][2];
static int hclass[NH];
static void init_hands() {
  int h = 0;
  for (int a = 0; a < 52; a++)
    for (int b = a + 1; b < 52; b++) {
      hcard[h][0] = a; hcard[h][1] = b;
      const int ra = a % 13, rb = b % 13, hi = ra > rb ? ra : rb, lo = ra > rb ? rb : ra;
      if (hi == lo) hclass[h] = hi;
      else hclass[h] = (a / 13 == b / 13 ? 13 : 91) + hi * (hi - 1) / 2 + lo;
      h++;
    }
}
// for every hand, the sum of r over the hands it shares no card with
static void compat_sum(const double* r, double* out) {
  double tot = 0, cs[52] = {0};
  for (int h = 0; h < NH; h++) { tot += r[h]; cs[hcard[h][0]] += r[h]; cs[hcard[h][1]] += r[h]; }
  for (int h = 0; h < NH; h++) out[h] = tot - cs[hcard[h][0]] - cs[hcard[h][1]] + r[h];
}

// C(50,5) / C(48,5): a board sampled for hand h misses a given opponent hand with probability C(48,5)/C(50,5)
static const double KSCALE = 2118760.0 / 1712304.0;

struct Preflop {
  const HuGame& g;
  std::vector<double> R, S;                       // [node][169][4]
  std::vector<double> sig;                        // current strategy [node][169][4]
  std::vector<double> reach;                      // [node][2][NH] at each node
  std::vector<double> lreach;                     // [leaf][2][NH] at each leaf
  std::vector<double> lval;                       // [leaf][2][NH] counterfactual values
  std::vector<double> nval;                       // [node][2][NH]
  double ev_sb = 0;

  explicit Preflop(const HuGame& game) : g(game) {
    R.assign((size_t)g.npn * 169 * 4, 0.0);
    S.assign((size_t)g.npn * 169 * 4, 0.0);
    sig.assign((size_t)g.npn * 169 * 4, 0.0);
    reach.assign((size_t)g.npn * 2 * NH, 0.0);
    lreach.assign((size_t)g.nleaves * 2 * NH, 0.0);
    lval.assign((size_t)g.nleaves * 2 * NH, 0.0);
    nval.assign((size_t)g.npn * 2 * NH, 0.0);
  }

  void strategy() {
    for (int n = 0; n < g.npn; n++)
      for (int c = 0; c < 169; c++) {
        double* s = &sig[((size_t)n * 169 + c) * 4];
        const double* r = &R[((size_t)n * 169 + c) * 4];
        double tot = 0; int cnt = 0;
        for (int a = 0; a < 4; a++) if (g.pn[n].a[a].kind >= 0) { tot += std::max(r[a], 0.0); cnt++; }
        for (int a = 0; a < 4; a++)
          s[a] = g.pn[n].a[a].kind < 0 ? 0.0 : (tot > 0 ? std::max(r[a], 0.0) / tot : 1.0 / cnt);
      }
  }

  // reach at every node and leaf from the current strategy; node 0 is the root and children follow parents
  void forward() {
    for (int x = 0; x < 2; x++) for (int h = 0; h < NH; h++) reach[(size_t)x * NH + h] = 1.0;
    for (int n = 0; n < g.npn; n++) {
      const int p = g.pn[n].player;
      for (int a = 0; a < 4; a++) {
        const PAct k = g.pn[n].a[a];
        if (k.kind < 0) continue;
        double* dst = k.kind == 0 ? &reach[(size_t)k.idx * 2 * NH] : &lreach[(size_t)k.idx * 2 * NH];
        for (int x = 0; x < 2; x++)
          for (int h = 0; h < NH; h++) {
            const double r = reach[((size_t)n * 2 + x) * NH + h];
            dst[(size_t)x * NH + h] = x == p ? r * sig[((size_t)n * 169 + hclass[h]) * 4 + a] : r;
          }
      }
    }
  }

  // the GPU walk's starting reach for every line: [line][2][NH]
  void line_ranges(std::vector<float>& rng) const {
    rng.assign((size_t)g.nlines * 2 * NH, 0.f);
    for (int l = 0; l < g.nlines; l++)
      for (int i = 0; i < 2 * NH; i++) rng[(size_t)l * 2 * NH + i] = (float)lreach[(size_t)g.lines[l].leaf * 2 * NH + i];
  }

  // leaf values (folds exact, lines from the walk), regrets and strategy sums back up the tree
  void backward(const std::vector<float>& lineval, const std::vector<int>& hcount, int t) {
    std::vector<double> tmp(NH);
    for (int li = 0; li < g.nleaves; li++) {
      const PLeaf& L = g.leaves[li];
      double* v = &lval[(size_t)li * 2 * NH];
      if (L.kind == 0) {
        const int f = L.folder;
        const double loss = f == 0 ? L.c0 : L.c1;
        for (int x = 0; x < 2; x++) {
          compat_sum(&lreach[((size_t)li * 2 + (1 - x)) * NH], tmp.data());
          for (int h = 0; h < NH; h++) v[(size_t)x * NH + h] = (x == f ? -loss : loss) * tmp[h];
        }
      } else {
        const float* lv = &lineval[(size_t)L.line * 2 * NH];
        for (int i = 0; i < 2 * NH; i++) {
          const int h = i % NH;
          v[i] = hcount[h] > 0 ? (double)lv[i] / hcount[h] * KSCALE : 0.0;
        }
      }
    }
    // discount the old regrets and sums (DCFR as on the GPU)
    if (t > 1) {
      const double tt = t - 1, pos = std::pow(tt, 1.5) / (std::pow(tt, 1.5) + 1.0), sg = std::pow(tt / (tt + 1.0), 2.0);
      for (auto& r : R) r *= r > 0 ? pos : 0.5;
      for (auto& s : S) s *= sg;
    }
    for (int n = g.npn - 1; n >= 0; n--) {                      // children have larger numbers
      const int p = g.pn[n].player;
      double* nv = &nval[(size_t)n * 2 * NH];
      for (int i = 0; i < 2 * NH; i++) nv[i] = 0;
      const double* kv[4] = {nullptr, nullptr, nullptr, nullptr};
      for (int a = 0; a < 4; a++) {
        const PAct k = g.pn[n].a[a];
        if (k.kind < 0) continue;
        kv[a] = k.kind == 0 ? &nval[(size_t)k.idx * 2 * NH] : &lval[(size_t)k.idx * 2 * NH];
        for (int h = 0; h < NH; h++) {
          nv[(size_t)p * NH + h] += sig[((size_t)n * 169 + hclass[h]) * 4 + a] * kv[a][(size_t)p * NH + h];
          nv[(size_t)(1 - p) * NH + h] += kv[a][(size_t)(1 - p) * NH + h];
        }
      }
      for (int h = 0; h < NH; h++) {
        const size_t row = ((size_t)n * 169 + hclass[h]) * 4;
        const double rp = reach[((size_t)n * 2 + p) * NH + h];
        for (int a = 0; a < 4; a++) {
          if (!kv[a]) continue;
          R[row + a] += kv[a][(size_t)p * NH + h] - nv[(size_t)p * NH + h];
          S[row + a] += rp * sig[row + a];
        }
      }
    }
    double s = 0;
    for (int h = 0; h < NH; h++) s += nval[(size_t)1 * NH + h];
    ev_sb = s / (1326.0 * 1225.0);                              // small blind's value per deal, big blinds
  }
};
