import AppNav from "../components/AppNav";
import TeamSettings from "../components/TeamSettings";
import "./Team.css";

function Team({ business, appUser }) {
  return (
    <div className="team-page">
      <AppNav business={business} />
      <div className="team-page-content">
        <TeamSettings business={business} appUser={appUser} />
      </div>
    </div>
  );
}

export default Team;