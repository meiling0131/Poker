//! The solver's blueprint for one stack depth (solver/hu_blueprint.py writes it).
//! Player 0 is the big blind, player 1 the small blind / button; amounts are in big blinds.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kid {
    None,
    Node(usize),
    Leaf(usize),
}

pub const PRE_ACTIONS: [&str; 4] = ["fold", "call", "raise", "allin"];

#[derive(Clone, Debug)]
pub struct PreNode { pub player: usize, pub c: [f32; 2], pub kids: [Kid; 4] }
#[derive(Clone, Debug)]
pub struct Leaf { pub kind: u8, pub c: [f32; 2], pub folder: i8, pub line: i32 }   // kind 0 fold, 1 show, 2 flop
#[derive(Clone, Debug)]
pub struct Line { pub kind: u8, pub pot: f32, pub behind: f32, pub root: i32 }
#[derive(Clone, Debug)]
pub struct Act { pub player: usize, pub street: usize, pub mask: u8, pub c: [f32; 2], pub kids: [i32; 6] }

pub const KID_NONE: i32 = -1;
pub const KID_FOLD: i32 = -2;
pub const KID_SHOW: i32 = -3;

pub struct Blueprint {
    pub stack: f32,
    pub nb: usize,
    pub abs: crate::abstraction::Abs,
    pub pre: Vec<PreNode>,
    pub pre_strat: Vec<f32>, // [node][169][4]
    pub leaves: Vec<Leaf>,
    pub lines: Vec<Line>,
    pub acts: Vec<Act>,
    pub post: Vec<u8>, // [act][4][nb][6]
}

struct Cur<'a> { b: &'a [u8], o: usize }
impl<'a> Cur<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.o + n > self.b.len() { return Err("blueprint file is truncated".into()); }
        let s = &self.b[self.o..self.o + n];
        self.o += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> { Ok(self.take(1)?[0]) }
    fn i8(&mut self) -> Result<i8, String> { Ok(self.take(1)?[0] as i8) }
    fn u32(&mut self) -> Result<u32, String> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn i32(&mut self) -> Result<i32, String> { Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn f32(&mut self) -> Result<f32, String> { Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn f64(&mut self) -> Result<f64, String> { Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap())) }
}

impl Blueprint {
    pub fn load(bytes: &[u8]) -> Result<Blueprint, String> {
        let mut c = Cur { b: bytes, o: 0 };
        if c.take(4)? != b"HUBP" { return Err("not a blueprint file".into()); }
        let version = c.u32()?;
        if version != 1 && version != 2 { return Err("unknown blueprint version".into()); }
        let stack = c.f32()?;
        let nb = c.u32()? as usize;
        let abs = if version == 1 {
            let mut edges = [0f64; 17];
            for e in edges.iter_mut() { *e = c.f64()?; }
            crate::abstraction::Abs::v1(&edges)
        } else {
            let mut r = crate::abstraction::Rd { b: c.b, o: c.o };
            let a = crate::abstraction::Abs::read_v2(&mut r)?;
            c.o = r.o;
            a
        };
        if abs.nb != nb { return Err("bucket count and abstraction differ".into()); }
        let (npn, nleaves, nlines, nact) = (c.u32()? as usize, c.u32()? as usize, c.u32()? as usize, c.u32()? as usize);
        let mut pre = Vec::with_capacity(npn);
        for _ in 0..npn {
            let player = c.u8()? as usize;
            let cc = [c.f32()?, c.f32()?];
            let mut kids = [Kid::None; 4];
            for k in kids.iter_mut() {
                let kind = c.i8()?;
                let idx = c.i32()?;
                *k = match kind { 0 => Kid::Node(idx as usize), 1 => Kid::Leaf(idx as usize), _ => Kid::None };
            }
            pre.push(PreNode { player, c: cc, kids });
        }
        let mut pre_strat = Vec::with_capacity(npn * 169 * 4);
        for _ in 0..npn * 169 * 4 { pre_strat.push(c.f32()?); }
        let mut leaves = Vec::with_capacity(nleaves);
        for _ in 0..nleaves {
            let kind = c.u8()?;
            let cc = [c.f32()?, c.f32()?];
            leaves.push(Leaf { kind, c: cc, folder: c.i8()?, line: c.i32()? });
        }
        let mut lines = Vec::with_capacity(nlines);
        for _ in 0..nlines {
            lines.push(Line { kind: c.u8()?, pot: c.f32()?, behind: c.f32()?, root: c.i32()? });
        }
        let mut acts = Vec::with_capacity(nact);
        for _ in 0..nact {
            let player = c.u8()? as usize;
            let street = c.u8()? as usize;
            let mask = c.u8()?;
            let cc = [c.f32()?, c.f32()?];
            let mut kids = [0i32; 6];
            for k in kids.iter_mut() { *k = c.i32()?; }
            acts.push(Act { player, street, mask, c: cc, kids });
        }
        let post = c.take(nact * 4 * nb * 6)?.to_vec();
        Ok(Blueprint { stack, nb, abs, pre, pre_strat, leaves, lines, acts, post })
    }

    pub fn pre_probs(&self, node: usize, cls: usize) -> [f32; 4] {
        let o = (node * 169 + cls) * 4;
        [self.pre_strat[o], self.pre_strat[o + 1], self.pre_strat[o + 2], self.pre_strat[o + 3]]
    }

    pub fn post_probs(&self, act: usize, tex: usize, bucket: usize) -> [f32; 6] {
        let o = ((act * 4 + tex) * self.nb + bucket) * 6;
        let r = &self.post[o..o + 6];
        let tot: u32 = r.iter().map(|&x| x as u32).sum();
        let mut p = [0f32; 6];
        if tot == 0 {
            let n = (0..6).filter(|s| self.acts[act].mask >> s & 1 == 1).count().max(1) as f32;
            for s in 0..6 { if self.acts[act].mask >> s & 1 == 1 { p[s] = 1.0 / n; } }
        } else {
            for s in 0..6 { p[s] = r[s] as f32 / tot as f32; }
        }
        p
    }
}
