import logo from "../assets/amboss-logo.png";

/** Frame the supplied transparent artwork without its surrounding empty canvas. */
export default function AmbossLogo() {
  return <svg className="amboss-logo" viewBox="90 685 3660 790" role="img" aria-label="AMBOSS" focusable="false">
    <image href={logo} x="0" y="0" width="3840" height="2160" />
  </svg>;
}
