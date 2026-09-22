import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Ultra-responsive, zero-delay emerald green cursor trail.
 * Portaled directly to document.body so it is never bounded by transformed ancestor divs.
 * Scoped strictly to LandingPage and Auth screens.
 */
export default function CursorTrail() {
  const canvasRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const updateSize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    updateSize();
    window.addEventListener('resize', updateSize, { passive: true });

    // Directly track real-time cursor with zero lag and zero delay
    const mouse = { x: -100, y: -100, prevX: -100, prevY: -100, moving: false };
    const trail = [];
    const maxTrail = 16; // Extended longer ribbon length (was 7)
    const particles = [];
    let idleTimer;

    class Particle {
      constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 1.8 + 0.4;
        this.vx = (vx * 0.14) + Math.cos(angle) * speed;
        this.vy = (vy * 0.14) + Math.sin(angle) * speed;
        this.size = Math.random() * 2.4 + 1.0;
        this.life = 1;
        this.decay = Math.random() * 0.055 + 0.045;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.91;
        this.vy *= 0.91;
        this.life -= this.decay;
      }
      draw(c) {
        if (this.life <= 0) return;
        c.save();
        c.beginPath();
        c.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
        c.fillStyle = `rgba(0, 229, 190, ${this.life * 0.85})`;
        c.shadowColor = 'rgba(0, 229, 190, 0.9)';
        c.shadowBlur = 5;
        c.fill();
        c.restore();
      }
    }

    const handleMouseMove = (e) => {
      const x = e.clientX;
      const y = e.clientY;
      const vx = x - (mouse.prevX === -100 ? x : mouse.prevX);
      const vy = y - (mouse.prevY === -100 ? y : mouse.prevY);
      mouse.prevX = x;
      mouse.prevY = y;
      mouse.x = x;
      mouse.y = y;
      mouse.moving = true;

      // Add point directly at cursor head (0 lag, 0 delay)
      trail.unshift({ x, y });
      if (trail.length > maxTrail) {
        trail.pop();
      }

      // Sparkles on movement - nice and airy
      const dist = Math.hypot(vx, vy);
      if (dist > 3.5 && particles.length < 24) {
        const count = Math.min(2, Math.floor(dist / 9) + 1);
        for (let i = 0; i < count; i++) {
          particles.push(new Particle(x, y, vx, vy));
        }
      }

      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        mouse.moving = false;
      }, 35);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // When scrolling, immediately clear trail points so it never detaches from cursor
    const handleScroll = () => {
      trail.length = 0;
      particles.length = 0;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Fade trail swiftly when stationary with zero lingering delay
      if (!mouse.moving && trail.length > 0) {
        trail.pop();
        if (trail.length > 8) {
          trail.pop();
        }
        if (trail.length > 0) {
          trail.pop();
        }
      }

      // Draw glowing emerald green ribbon trail
      if (trail.length > 1) {
        ctx.save();
        for (let i = 0; i < trail.length - 1; i++) {
          const p1 = trail[i];
          const p2 = trail[i + 1];
          const ratio = 1 - i / trail.length;
          const lineWidth = Math.max(1.2, ratio * 5.5);

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(0, 229, 190, ${ratio * 0.85})`;
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = 'rgba(0, 229, 190, 0.9)';
          ctx.shadowBlur = 8;
          ctx.stroke();
        }
        ctx.restore();
      }

      // Cursor tip dot with glow
      if (mouse.x > 0 && mouse.y > 0 && mouse.moving) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00e5be';
        ctx.shadowColor = '#00e5be';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      }

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        p.draw(ctx);
        if (p.life <= 0) {
          particles.splice(i, 1);
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(idleTimer);
    };
  }, [mounted]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 999999,
      }}
      aria-hidden="true"
    />,
    document.body
  );
}
