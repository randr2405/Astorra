import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { getModule, getModuleLimit } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./AIBuilder.css";

function AIBuilder({ business, appUser, onBusinessUpdate }) {
  const navigate = useNavigate();
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { modules: [...], reasoning }
  const [installing, setInstalling] = useState(false);

  const installed = business?.installed_modules || [];
  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const atCap = installed.length >= limit;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;

    setError("");
    setResult(null);
    setLoading(true);

    const { data, error: fnError } = await supabase.functions.invoke("ai-builder", {
      body: { description: description.trim(), installed_modules: installed },
    });

    setLoading(false);

    if (fnError || data?.error) {
      setError(data?.error || fnError.message || "Something went wrong. Please try again.");
      return;
    }

    setResult(data);
  };

  const handleInstallAll = async () => {
    if (!result?.modules?.length) return;

    const room = limit - installed.length;
    if (room <= 0) {
      setError(`Your ${plan} plan is at its module limit. Upgrade to install more.`);
      return;
    }

    setInstalling(true);
    const toInstall = result.modules.slice(0, room);
    const nextModules = [...installed, ...toInstall];

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update({ installed_modules: nextModules })
      .eq("id", business.id)
      .select()
      .single();

    setInstalling(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);

    const names = toInstall.map((k) => getModule(k)?.name || k).join(", ");
    notify(business.id, appUser?.id, `AI Builder installed: ${names}.`);

    if (toInstall.length < result.modules.length) {
      setError(
        `Installed ${toInstall.length} of ${result.modules.length} recommended modules — your plan is now at its limit.`
      );
    } else {
      navigate("/dashboard");
    }
  };

  return (
    <div className="aib-page">
      <AppNav business={business} />

      <div className="aib-body">
        <p className="aib-eyebrow">AI Builder</p>
        <h1 className="aib-heading">Describe your problem. We'll set it up.</h1>
        <p className="aib-sub">
          Tell us what your business does, in your own words — no need to know which modules
          exist.
        </p>

        <form className="aib-form" onSubmit={handleSubmit}>
          <textarea
            className="aib-textarea"
            rows={4}
            placeholder="e.g. We hire out equipment and need to track who has what"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit" className="aib-submit" disabled={loading || !description.trim()}>
            {loading ? "Thinking..." : "Get recommendations"}
          </button>
        </form>

        {error && <p className="aib-error">{error}</p>}

        {result && (
          <div className="aib-result">
            {result.modules.length === 0 ? (
              <p className="aib-reasoning">{result.reasoning}</p>
            ) : (
              <>
                <p className="aib-reasoning">{result.reasoning}</p>

                <div className="aib-module-list">
                  {result.modules.map((key) => {
                    const mod = getModule(key);
                    if (!mod) return null;
                    return (
                      <div className="aib-module-card" key={key}>
                        <div className="aib-module-icon">{mod.initial}</div>
                        <div>
                          <h3>{mod.name}</h3>
                          <p>{mod.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {atCap ? (
                  <p className="aib-cap-notice">
                    Your {plan} plan is at its module limit.{" "}
                    <button className="aib-inline-link" onClick={() => navigate("/dashboard/billing")}>
                      Upgrade
                    </button>{" "}
                    to install these.
                  </p>
                ) : (
                  <button className="aib-install-btn" onClick={handleInstallAll} disabled={installing}>
                    {installing ? "Installing..." : `Install ${result.modules.length > 1 ? "these modules" : "this module"}`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AIBuilder;