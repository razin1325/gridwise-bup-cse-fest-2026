'use client';

import { useEffect, useRef } from 'react';

export default function ElectricityAnimation() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let rafId: number;
    let then = Date.now();
    const fps = 30; // 30 fps for smooth high-voltage arcing
    const interval = 1000 / fps;

    const generateMainPath = (): string => {
      const width = 1000;
      const height = 200;
      const centerY = 100;
      const numSegments = 16;
      const points: [number, number][] = [[0, centerY]];

      for (let i = 1; i < numSegments; i++) {
        const x = (i / numSegments) * width + (Math.random() - 0.5) * 20;
        // Dampen displacement near the ends so it stays connected to the diode balls
        const edgeFactor = Math.sin((i / numSegments) * Math.PI);
        const maxOffset = 65 * edgeFactor;
        const y = centerY + (Math.random() - 0.5) * maxOffset;
        points.push([x, y]);
      }

      points.push([width, centerY]);
      return 'M ' + points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ');
    };

    const generateForkPath = (mainPathPointsStr: string): string => {
      // Occasionally create a small branching spark
      if (Math.random() > 0.4) return '';
      const coords = mainPathPointsStr
        .replace('M ', '')
        .split(' L ')
        .map((p) => p.split(',').map(Number));

      if (coords.length < 6) return '';
      const branchIdx = Math.floor(Math.random() * (coords.length - 4)) + 2;
      const startCoords = coords[branchIdx];
      if (!startCoords) return '';

      const [sx, sy] = startCoords;
      const branchLen = 40 + Math.random() * 50;
      const angle = (Math.random() - 0.5) * Math.PI * 0.8;
      const ex = sx + Math.cos(angle) * branchLen;
      const ey = sy + Math.sin(angle) * branchLen;

      return `M ${sx},${sy} L ${sx + (ex - sx) * 0.5 + (Math.random() - 0.5) * 15},${sy + (ey - sy) * 0.5 + (Math.random() - 0.5) * 15} L ${ex},${ey}`;
    };

    const render = () => {
      const mainPathD = generateMainPath();
      const forkPathD = generateForkPath(mainPathD);

      const mainPaths = svg.querySelectorAll('.main-bolt');
      mainPaths.forEach((p) => p.setAttribute('d', mainPathD));

      const forkPath = svg.querySelector('.fork-bolt');
      if (forkPath) forkPath.setAttribute('d', forkPathD);
    };

    const loop = () => {
      rafId = requestAnimationFrame(loop);
      const now = Date.now();
      const delta = now - then;
      if (delta > interval) {
        then = now - (delta % interval);
        render();
      }
    };

    loop();
    return () => cancelAnimationFrame(rafId);
  }, []);

  const Diode = ({ isRight }: { isRight?: boolean }) => {
    return (
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          ...(isRight ? { right: '8vw' } : { left: '8vw' }),
          height: 'calc(100vh - 18vh)',
          width: '1.4vh',
          minWidth: '14px',
          background: 'linear-gradient(to right, #64748b, #334155, #1e293b)',
          borderTopLeftRadius: '2px',
          borderTopRightRadius: '2px',
          zIndex: 4,
          boxShadow: '0 0 10px rgba(0,0,0,0.5)',
        }}
      >
        {/* Specular edge highlight */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '2px',
            width: '2px',
            background: 'rgba(255,255,255,0.3)',
          }}
        />

        {/* Diode Sphere Ball on top */}
        <div
          style={{
            position: 'absolute',
            top: '-3.5vh',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '7vh',
            height: '7vh',
            minWidth: '60px',
            minHeight: '60px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #94a3b8 0%, #334155 50%, #0f172a 100%)',
            boxShadow: '0 0 10px rgba(66, 238, 119, 0.22), inset 0 0 15px rgba(0,0,0,0.8)',
            zIndex: 10,
          }}
        >
          {/* Internal Green Plasma Glow */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: '#42ee77',
              boxShadow: '0 0 12px 5px #42ee77, 0 0 22px 8px rgba(66, 238, 119, 0.35)',
            }}
          />

          {/* Specular White Dot */}
          <div
            style={{
              position: 'absolute',
              top: '18%',
              left: '22%',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.85)',
              filter: 'blur(1px)',
            }}
          />
        </div>

        {/* Top Socket Connector */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '3.2vh',
            height: '1.2vh',
            minWidth: '28px',
            minHeight: '12px',
            background: 'linear-gradient(to bottom, #1e293b, #0f172a)',
            border: '1px solid #475569',
            borderRadius: '3px',
            zIndex: 5,
          }}
        />

        {/* Decorative Rings */}
        {[18, 42, 68].map((topPercent, idx) => (
          <div
            key={idx}
            style={{
              position: 'absolute',
              top: `${topPercent}%`,
              left: '50%',
              transform: 'translateX(-50%)',
              width: `${3.6 - idx * 0.4}vh`,
              minWidth: `${32 - idx * 4}px`,
              height: '1vh',
              minHeight: '10px',
              background: 'linear-gradient(to bottom, #475569, #1e293b)',
              border: '1px solid #64748b',
              borderRadius: '4px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.6)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '2px',
                left: '10%',
                width: '80%',
                height: '1px',
                background: 'rgba(255,255,255,0.3)',
              }}
            />
          </div>
        ))}

        {/* Bottom Socket Base */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '5vh',
            minWidth: '46px',
            height: '2.5vh',
            minHeight: '22px',
            background: 'linear-gradient(to bottom, #334155, #0f172a)',
            borderTop: '2px solid #64748b',
            borderRadius: '4px 4px 0 0',
            boxShadow: '0 -2px 10px rgba(0,0,0,0.5)',
            zIndex: 5,
          }}
        />
      </div>
    );
  };

  return (
    <div
      className="hidden md:block"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {/* Left Diode Tower */}
      <Diode />

      {/* Right Diode Tower */}
      <Diode isRight />

      {/* SVG Lightning Bolt connecting the two diode sphere centers at 18vh */}
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          top: '18vh',
          left: '8vw',
          width: 'calc(100vw - 16vw)',
          height: '200px',
          transform: 'translateY(-50%)',
          zIndex: 2,
          opacity: 0.7,
        }}
      >
        <defs>
          <filter id="elec-glow-heavy" x="-20%" y="-100%" width="140%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
          <filter id="elec-glow-soft" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
          </filter>
        </defs>

        <g>
          {/* Subtle Outer Glow */}
          <path
            className="main-bolt"
            d=""
            fill="none"
            stroke="#42ee77"
            strokeWidth="4"
            filter="url(#elec-glow-heavy)"
            opacity="0.35"
          />
          {/* Soft Mid Glow */}
          <path
            className="main-bolt"
            d=""
            fill="none"
            stroke="#34d399"
            strokeWidth="2"
            filter="url(#elec-glow-soft)"
            opacity="0.5"
          />
          {/* Core Lightning Wire */}
          <path
            className="main-bolt"
            d=""
            fill="none"
            stroke="#a7f3d0"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.8"
          />
          {/* Secondary Fork Spark */}
          <path
            className="fork-bolt"
            d=""
            fill="none"
            stroke="#6ee7b7"
            strokeWidth="0.8"
            filter="url(#elec-glow-soft)"
            opacity="0.45"
          />
        </g>
      </svg>
    </div>
  );
}

