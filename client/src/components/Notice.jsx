import { CheckIcon, CloseIcon } from "./Icons";

// Success / error message box with a close (×) button.
//   type: "ok" | "error" | "info"     onClose: hides it     children: extra buttons
export default function Notice({ type = "info", text, onClose, children }) {
  if (!text) return null;
  const cls = type === "ok" ? "success" : type === "error" ? "alert" : "alert info";
  return (
    <div className={`${cls} notice`} role={type === "error" ? "alert" : "status"}>
      {type === "ok" && <CheckIcon />}
      <span className="notice-text">{text}</span>
      {children}
      {onClose && (
        <button type="button" className="notice-close" onClick={onClose} aria-label="Close message" title="Close">
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
