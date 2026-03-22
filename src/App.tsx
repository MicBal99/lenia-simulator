import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Trash2, Pen, Eraser } from 'lucide-react';

// Precompute Color Lookup Table for beautiful rendering
const COLOR_LUT = new Uint8Array(1024 * 4);
for (let i = 0; i < 1024; i++) {
  const v = i / 1023;
  let r, g, b;
  if (v < 0.15) {
    const t = v / 0.15;
    r = 10 * (1 - t) + 15 * t;
    g = 15 * (1 - t) + 40 * t;
    b = 28 * (1 - t) + 90 * t;
  } else if (v < 0.4) {
    const t = (v - 0.15) / 0.25;
    r = 15 * (1 - t) + 20 * t;
    g = 40 * (1 - t) + 150 * t;
    b = 90 * (1 - t) + 180 * t;
  } else if (v < 0.7) {
    const t = (v - 0.4) / 0.3;
    r = 20 * (1 - t) + 100 * t;
    g = 150 * (1 - t) + 255 * t;
    b = 180 * (1 - t) + 150 * t;
  } else if (v < 0.9) {
    const t = (v - 0.7) / 0.2;
    r = 100 * (1 - t) + 220 * t;
    g = 255 * (1 - t) + 255 * t;
    b = 150 * (1 - t) + 200 * t;
  } else {
    const t = (v - 0.9) / 0.1;
    r = 220 * (1 - t) + 255 * t;
    g = 255 * (1 - t) + 255 * t;
    b = 200 * (1 - t) + 255 * t;
  }
  COLOR_LUT[i * 4] = r;
  COLOR_LUT[i * 4 + 1] = g;
  COLOR_LUT[i * 4 + 2] = b;
  COLOR_LUT[i * 4 + 3] = 255;
}

// Parameters for a more chaotic, self-sustaining organic soup
const R = 12;
const MU = 0.14;
const SIGMA = 0.014;
const DT = 0.1;

type Tool = 'draw' | 'erase';

export default function App() {
  const [dims, setDims] = useState(() => {
    if (typeof window === 'undefined') return { W: 200, H: 200 };
    const aspect = window.innerWidth / window.innerHeight;
    const totalCells = 40000;
    const H = Math.max(50, Math.round(Math.sqrt(totalCells / aspect)));
    const W = Math.max(50, Math.round(H * aspect));
    return { W, H };
  });

  const { W, H } = dims;

  useEffect(() => {
    const handleResize = () => {
      const aspect = window.innerWidth / window.innerHeight;
      const totalCells = 40000;
      const newH = Math.max(50, Math.round(Math.sqrt(totalCells / aspect)));
      const newW = Math.max(50, Math.round(newH * aspect));
      setDims(prev => {
        if (prev.W === newW && prev.H === newH) return prev;
        return { W: newW, H: newH };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTool, setActiveTool] = useState<Tool>('draw');
  
  const gridRef = useRef(new Float32Array(0));
  const nextGridRef = useRef(new Float32Array(0));
  const imgDataRef = useRef<ImageData | null>(null);
  const kernelDataRef = useRef<{ offsets: Int32Array, weights: Float32Array, pW: number, pH: number, gLut?: Float32Array }>({ offsets: new Int32Array(0), weights: new Float32Array(0), pW: 0, pH: 0 });
  const reqRef = useRef<number>();
  const isDrawingRef = useRef(false);

  // Initialize grid and precompute kernel when dimensions change
  useEffect(() => {
    gridRef.current = new Float32Array(W * H);
    nextGridRef.current = new Float32Array(W * H);
    imgDataRef.current = null;

    const grid = gridRef.current;
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    const radius = 25;
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x * x + y * y <= radius * radius) {
          if (Math.random() > 0.5) {
            grid[(cy + y) * W + (cx + x)] = Math.random();
          }
        }
      }
    }

    const pW = W + 2 * R;
    const pH = H + 2 * R;
    const offsets = [];
    const weights = [];
    let sum = 0;
    
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const r = Math.sqrt(x * x + y * y) / R;
        if (r > 0 && r < 1) {
          const val = Math.exp(4 - 1 / (r * (1 - r)));
          offsets.push(y * pW + x);
          weights.push(val);
          sum += val;
        }
      }
    }
    
    const offsetsArray = new Int32Array(offsets.length);
    const weightsArray = new Float32Array(weights.length);
    for (let i = 0; i < offsets.length; i++) {
      offsetsArray[i] = offsets[i];
      weightsArray[i] = weights[i] / sum;
    }
    
    kernelDataRef.current = { offsets: offsetsArray, weights: weightsArray, pW, pH, gLut: kernelDataRef.current.gLut };
  }, [W, H]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    if (!imgDataRef.current) {
      imgDataRef.current = ctx.createImageData(W, H);
    }
    const imgData = imgDataRef.current;
    const data = imgData.data;
    const grid = gridRef.current;
    
    for (let i = 0; i < grid.length; i++) {
      let v = grid[i];
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      
      const lutIdx = (v * 1023) | 0;
      const idx = i * 4;
      const cIdx = lutIdx * 4;
      
      data[idx] = COLOR_LUT[cIdx];
      data[idx + 1] = COLOR_LUT[cIdx + 1];
      data[idx + 2] = COLOR_LUT[cIdx + 2];
      data[idx + 3] = 255;
    }
    
    ctx.putImageData(imgData, 0, 0);
  };

  const step = () => {
    const grid = gridRef.current;
    const nextGrid = nextGridRef.current;
    const { offsets, weights, pW, pH } = kernelDataRef.current;
    const K_LEN = offsets.length;
    
    if (K_LEN === 0) return;

    const padded = new Float32Array(pW * pH);

    // Pad center
    for (let y = 0; y < H; y++) {
      padded.set(grid.subarray(y * W, y * W + W), (y + R) * pW + R);
    }

    // Pad top and bottom
    for (let y = 0; y < R; y++) {
      padded.set(grid.subarray((H - R + y) * W, (H - R + y) * W + W), y * pW + R);
      padded.set(grid.subarray(y * W, y * W + W), (H + R + y) * pW + R);
    }

    // Pad left and right
    for (let y = 0; y < pH; y++) {
      const rowStart = y * pW;
      for (let x = 0; x < R; x++) {
        padded[rowStart + x] = padded[rowStart + W + x];
        padded[rowStart + R + W + x] = padded[rowStart + R + x];
      }
    }

    const INV_SIGMA2 = 1 / (2 * SIGMA * SIGMA);
    
    // Precompute Growth function Lookup Table (LUT) if not already done
    if (!kernelDataRef.current.gLut) {
      const lut = new Float32Array(10000);
      for (let i = 0; i < 10000; i++) {
        const u = i / 9999;
        const dU = u - MU;
        lut[i] = 2 * Math.exp(-(dU * dU) * INV_SIGMA2) - 1;
      }
      kernelDataRef.current.gLut = lut;
    }
    const gLut = kernelDataRef.current.gLut!;

    // Convolution
    for (let y = 0; y < H; y++) {
      let pIdx = (y + R) * pW + R;
      let gIdx = y * W;
      for (let x = 0; x < W; x++) {
        let U = 0;
        for (let k = 0; k < K_LEN; k++) {
          U += padded[pIdx + offsets[k]] * weights[k];
        }
        
        // Fast LUT lookup instead of Math.exp
        let uIdx = (U * 9999) | 0;
        if (uIdx < 0) uIdx = 0;
        else if (uIdx > 9999) uIdx = 9999;
        
        const G = gLut[uIdx];
        const val = grid[gIdx] + DT * G;
        nextGrid[gIdx] = Math.max(0, Math.min(1, val));
        
        pIdx++;
        gIdx++;
      }
    }
    
    gridRef.current = nextGrid;
    nextGridRef.current = grid;
  };

  useEffect(() => {
    const loop = () => {
      if (isPlaying) {
        step();
        step();
      }
      drawCanvas();
      reqRef.current = requestAnimationFrame(loop);
    };
    reqRef.current = requestAnimationFrame(loop);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, [isPlaying, W, H]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    
    return { x: Math.floor(x), y: Math.floor(y) };
  };

  const applyBrush = (cx: number, cy: number) => {
    const grid = gridRef.current;
    const radius = Math.max(3, Math.floor(R / 2));
    let changed = false;
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          let gx = (cx + dx + W) % W;
          let gy = (cy + dy + H) % H;
          let idx = gy * W + gx;
          
          if (activeTool === 'draw') {
            grid[idx] = Math.random();
          } else {
            grid[idx] = 0;
          }
          changed = true;
        }
      }
    }
    if (changed && !isPlaying) drawCanvas();
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawingRef.current = true;
    const coords = getCoords(e);
    if (coords) applyBrush(coords.x, coords.y);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current) return;
    const coords = getCoords(e);
    if (coords) applyBrush(coords.x, coords.y);
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
  };

  const clearGrid = () => {
    gridRef.current.fill(0);
    if (!isPlaying) drawCanvas();
  };

  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden relative select-none">
      <div className="absolute inset-0 w-full h-full bg-black">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full h-full object-cover cursor-crosshair touch-none"
          style={{
            filter: 'blur(2px) contrast(400%) saturate(150%) brightness(110%)',
            backgroundColor: 'black'
          }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
      </div>

      <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-slate-900/80 backdrop-blur-xl p-2 rounded-2xl border border-slate-700/50 shadow-2xl flex flex-col items-center gap-2 z-10">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-2.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white transition-all active:scale-95"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        
        <div className="h-px w-8 bg-slate-700/50 my-1" />
        
        <button
          onClick={() => setActiveTool('draw')}
          className={`p-2.5 rounded-xl transition-all active:scale-95 ${
            activeTool === 'draw' 
              ? 'bg-cyan-500/20 text-cyan-400' 
              : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title="Draw Life"
        >
          <Pen size={20} />
        </button>
        
        <button
          onClick={() => setActiveTool('erase')}
          className={`p-2.5 rounded-xl transition-all active:scale-95 ${
            activeTool === 'erase' 
              ? 'bg-red-500/20 text-red-400' 
              : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title="Eraser"
        >
          <Eraser size={20} />
        </button>

        <div className="h-px w-8 bg-slate-700/50 my-1" />

        <button
          onClick={clearGrid}
          className="p-2.5 rounded-xl hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-all active:scale-95"
          title="Clear All"
        >
          <Trash2 size={20} />
        </button>
      </div>
    </div>
  );
}
