# Heads-up blueprint trainer (H100 = sm_90). On Gautschi: export PATH=/apps/gautschi/cuda/12.8/bin:$PATH
NVCC ?= nvcc
ARCH ?= sm_90
FLAGS = -O3 -std=c++17 -arch=$(ARCH) -lineinfo --expt-relaxed-constexpr -Xptxas -v

pcfr_hu3: hu_main.cu hu_host.cuh common.cuh board.cuh precompute.cuh walk.cuh host.cuh
	$(NVCC) $(FLAGS) hu_main.cu -o pcfr_hu3 2> build.log || (cat build.log; false)
	@grep -A2 "walk_kernel" build.log | grep -E "registers|spill" || true

clean:
	rm -f pcfr_hu3 build.log
