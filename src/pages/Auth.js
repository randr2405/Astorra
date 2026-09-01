import { useState, useRef, useEffect } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  GoogleAuthProvider,
} from "firebase/auth";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import { auth } from "../lib/firebase";
import astorraLogo from "../assets/astorra-logo.png";
import "./Auth.css";

/* ------------------------------------------------------------------ */
/* LiquidChrome background (inlined — no separate file/import needed)  */
/* ------------------------------------------------------------------ */

function LiquidChrome({
  baseColor = [0.05, 0.09, 0.18],
  speed = 0.2,
  amplitude = 0.3,
  frequencyX = 3,
  frequencyY = 3,
  interactive = true,
  ...props
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const renderer = new Renderer({ antialias: true });
    const gl = renderer.gl;
    gl.clearColor(1, 1, 1, 1);

    const vertexShader = `
      attribute vec2 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      uniform float uTime;
      uniform vec3 uResolution;
      uniform vec3 uBaseColor;
      uniform float uAmplitude;
      uniform float uFrequencyX;
      uniform float uFrequencyY;
      uniform vec2 uMouse;
      varying vec2 vUv;

      vec4 renderImage(vec2 uvCoord) {
          vec2 fragCoord = uvCoord * uResolution.xy;
          vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);

          for (float i = 1.0; i < 10.0; i++){
              uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
              uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
          }

          vec2 diff = (uvCoord - uMouse);
          float dist = length(diff);
          float falloff = exp(-dist * 20.0);
          float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
          uv += (diff / (dist + 0.0001)) * ripple * falloff;

          vec3 color = uBaseColor / abs(sin(uTime - uv.y - uv.x));
          return vec4(color, 1.0);
      }

      void main() {
          vec4 col = vec4(0.0);
          int samples = 0;
          for (int i = -1; i <= 1; i++){
              for (int j = -1; j <= 1; j++){
                  vec2 offset = vec2(float(i), float(j)) * (1.0 / min(uResolution.x, uResolution.y));
                  col += renderImage(vUv + offset);
                  samples++;
              }
          }
          gl_FragColor = col / float(samples);
      }
    `;

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: {
          value: new Float32Array([gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height]),
        },
        uBaseColor: { value: new Float32Array(baseColor) },
        uAmplitude: { value: amplitude },
        uFrequencyX: { value: frequencyX },
        uFrequencyY: { value: frequencyY },
        uMouse: { value: new Float32Array([0, 0]) },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    function resize() {
      const scale = 1;
      renderer.setSize(container.offsetWidth * scale, container.offsetHeight * scale);
      const resUniform = program.uniforms.uResolution.value;
      resUniform[0] = gl.canvas.width;
      resUniform[1] = gl.canvas.height;
      resUniform[2] = gl.canvas.width / gl.canvas.height;
    }
    window.addEventListener("resize", resize);
    resize();

    function handleMouseMove(event) {
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = 1 - (event.clientY - rect.top) / rect.height;
      const mouseUniform = program.uniforms.uMouse.value;
      mouseUniform[0] = x;
      mouseUniform[1] = y;
    }

    function handleTouchMove(event) {
      if (event.touches.length > 0) {
        const touch = event.touches[0];
        const rect = container.getBoundingClientRect();
        const x = (touch.clientX - rect.left) / rect.width;
        const y = 1 - (touch.clientY - rect.top) / rect.height;
        const mouseUniform = program.uniforms.uMouse.value;
        mouseUniform[0] = x;
        mouseUniform[1] = y;
      }
    }

    if (interactive) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("touchmove", handleTouchMove);
    }

    let animationId;
    function update(t) {
      animationId = requestAnimationFrame(update);
      program.uniforms.uTime.value = t * 0.001 * speed;
      renderer.render({ scene: mesh });
    }
    animationId = requestAnimationFrame(update);

    container.appendChild(gl.canvas);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      if (interactive) {
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("touchmove", handleTouchMove);
      }
      if (gl.canvas.parentElement) {
        gl.canvas.parentElement.removeChild(gl.canvas);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [baseColor, speed, amplitude, frequencyX, frequencyY, interactive]);

  return <div ref={containerRef} className="liquidChrome-container" {...props} />;
}

/* ------------------------------------------------------------------ */
/* Auth page                                                            */
/* ------------------------------------------------------------------ */

const friendlyAuthError = (code) => {
  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try logging in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/weak-password":
      return "Your password should be at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "";
    default:
      return "Something went wrong. Please try again.";
  }
};

function Auth() {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setResetSent(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await sendPasswordResetEmail(auth, email);
        setResetSent(true);
      }
    } catch (err) {
      console.error("Auth error:", err);
      const message = friendlyAuthError(err.code);
      if (message) setError(message);
    }

    setSubmitting(false);
  };

  const handleGoogleSignIn = async () => {
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Google sign-in error:", err);
      const message = friendlyAuthError(err.code);
      if (message) setError(message);
    }
  };

  const heading =
    mode === "signup" ? "Create your account" : mode === "login" ? "Log in" : "Reset your password";

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-liquid">
          <LiquidChrome
            baseColor={[0.05, 0.09, 0.18]}
            speed={0.3}
            amplitude={0.3}
            frequencyX={3}
            frequencyY={3}
            interactive
          />
        </div>
        <div className="auth-scrim"></div>
        <span className="auth-particle auth-particle-1"></span>
        <span className="auth-particle auth-particle-2"></span>
        <span className="auth-particle auth-particle-3"></span>
        <span className="auth-particle auth-particle-4"></span>
        <span className="auth-particle auth-particle-5"></span>
        <span className="auth-particle auth-particle-6"></span>
        <span className="auth-particle auth-particle-7"></span>
        <span className="auth-particle auth-particle-8"></span>
        <div className="auth-grid"></div>
      </div>

      <div className="auth-card" key={mode}>
        <img src={astorraLogo} alt="Astorra" className="auth-logo" />
        <p className="auth-slogan">One platform. Your way.</p>

        <h2 className="auth-heading">{heading}</h2>

        {mode === "reset" && !resetSent && (
          <p className="auth-reset-hint">
            Enter the email on your account and we'll send you a link to reset your password.
          </p>
        )}

        {resetSent ? (
          <p className="auth-reset-sent">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your
            inbox.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              className="auth-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {mode !== "reset" && (
              <input
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}

            {error && <p className="auth-error">{error}</p>}

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting
                ? "Please wait..."
                : mode === "signup"
                ? "Sign up"
                : mode === "login"
                ? "Log in"
                : "Send reset link"}
            </button>
          </form>
        )}

        {mode !== "reset" && (
          <>
            <div className="auth-divider">or</div>

            <button onClick={handleGoogleSignIn} className="auth-google">
              Continue with Google
            </button>
          </>
        )}

        <p className="auth-switch">
          {mode === "signup" && (
            <>
              Already have an account?{" "}
              <button className="auth-switch-btn" onClick={() => switchMode("login")}>
                Log in
              </button>
            </>
          )}
          {mode === "login" && (
            <>
              Don't have an account?{" "}
              <button className="auth-switch-btn" onClick={() => switchMode("signup")}>
                Sign up
              </button>
              <br />
              <button className="auth-switch-btn auth-forgot-btn" onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
            </>
          )}
          {mode === "reset" && (
            <button className="auth-switch-btn" onClick={() => switchMode("login")}>
              Back to log in
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

export default Auth;