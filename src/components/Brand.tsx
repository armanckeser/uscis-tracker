import { BASE_PATH } from "../lib/mode";

export function Brand() {
  return (
    <div className="brand-lockup">
      <img className="brand-mark" src={`${BASE_PATH}app-icon.svg`} alt="" width={28} height={28} />
      <span className="brand-title">USCIS Tracker</span>
    </div>
  );
}
