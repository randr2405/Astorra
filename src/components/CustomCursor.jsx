import { useEffect, useRef } from "react";
import "./CustomCursor.css";

function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const posRef = useRef({ x: 0, y: 0 });
  const ringPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    if (isCoarse) return;

    document.body.classList.add("custom-cursor-active");

    const isInteractive = (el) =>
      el.closest("button, a, input, textarea, select, [data-cursor='hover']");

    const handleMove = (e) => {
      posRef.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      }
    };

    const handleOver = (e) => {
      if (isInteractive(e.target)) {
        ringRef.current?.classList.add("is-hovering");
      }
    };

    const handleOut = (e) => {
      if (isInteractive(e.target)) {
        ringRef.current?.classList.remove("is-hovering");
      }
    };

    const handleDown = () => ringRef.current?.classList.add("is-pressing");
    const handleUp = () => ringRef.current?.classList.remove("is-pressing");

    const handleLeaveWindow = () => {
      dotRef.current?.classList.add("is-hidden");
      ringRef.current?.classList.add("is-hidden");
    };

    const handleEnterWindow = () => {
      dotRef.current?.classList.remove("is-hidden");
      ringRef.current?.classList.remove("is-hidden");
    };

    let rafId;
    const animateRing = () => {
      const dx = posRef.current.x - ringPosRef.current.x;
      const dy = posRef.current.y - ringPosRef.current.y;
      ringPosRef.current.x += dx * 0.18;
      ringPosRef.current.y += dy * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ringPosRef.current.x}px, ${ringPosRef.current.y}px, 0) translate(-50%, -50%)`;
      }
      rafId = requestAnimationFrame(animateRing);
    };
    rafId = requestAnimationFrame(animateRing);

    window.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseover", handleOver);
    document.addEventListener("mouseout", handleOut);
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("mouseup", handleUp);
    document.addEventListener("mouseleave", handleLeaveWindow);
    document.addEventListener("mouseenter", handleEnterWindow);

    return () => {
      document.body.classList.remove("custom-cursor-active");
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseover", handleOver);
      document.removeEventListener("mouseout", handleOut);
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("mouseup", handleUp);
      document.removeEventListener("mouseleave", handleLeaveWindow);
      document.removeEventListener("mouseenter", handleEnterWindow);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="custom-cursor-dot" />
      <div ref={ringRef} className="custom-cursor-ring" />
    </>
  );
}

export default CustomCursor;