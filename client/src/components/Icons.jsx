const Svg = ({ size = 16, children }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{children}</svg>
);
const P = ({ d }) => <path fill="currentColor" d={d} />;

export const RefreshIcon = () => <Svg><P d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" /></Svg>;
export const SunIcon = () => <Svg size={18}><P d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM3.5 4.9l1.4-1.4 2.1 2.1-1.4 1.4zm13 13 1.4-1.4 2.1 2.1-1.4 1.4zM1 11h3v2H1zm19 0h3v2h-3zM4.9 20.5l-1.4-1.4 2.1-2.1 1.4 1.4zm13-13-1.4-1.4 2.1-2.1 1.4 1.4z" /></Svg>;
export const MoonIcon = () => <Svg size={18}><P d="M12.3 2a10 10 0 1 0 9.7 12.4A8 8 0 0 1 12.3 2z" /></Svg>;
export const ChevronLeft = ({ size = 16 }) => <Svg size={size}><P d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></Svg>;
export const ChevronRight = ({ size = 16 }) => <Svg size={size}><P d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></Svg>;
export const CloseIcon = () => <Svg size={18}><P d="M19.8 5.7 13.5 12l6.3 6.3-1.4 1.4-6.3-6.3-6.3 6.3-1.4-1.4L10.7 12 4.4 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></Svg>;
export const BuildingIcon = () => <Svg><P d="M12 3 2 9v2h20V9L12 3zm-7 9v6H3v3h18v-3h-2v-6h-2v6h-3v-6h-2v6H7v-6H5z" /></Svg>;
export const CheckIcon = () => <Svg><P d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></Svg>;
export const ClockIcon = () => <Svg><P d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11h-5v-2h3V6h2v7z" /></Svg>;
export const EyeIcon = () => <Svg size={18}><P d="M12 5C6.5 5 2.7 8.6 1 12c1.7 3.4 5.5 7 11 7s9.3-3.6 11-7c-1.7-3.4-5.5-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" /></Svg>;
export const EyeOffIcon = () => <Svg size={18}><P d="M2.8 4.2 4.2 2.8l17 17-1.4 1.4-3.1-3.1A11.6 11.6 0 0 1 12 19c-5.5 0-9.3-3.6-11-7a13.4 13.4 0 0 1 4.2-4.9L2.8 4.2zM12 5c5.5 0 9.3 3.6 11 7-.7 1.4-1.7 2.8-3 4l-3.2-3.2A4.5 4.5 0 0 0 11.2 7.2L8.9 5A11 11 0 0 1 12 5zm-3.9 5.5a4.5 4.5 0 0 0 5.4 5.4L8.1 10.5z" /></Svg>;
export const LogoutIcon = () => <Svg><P d="M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9V3zm-1.6 4.6L9.8 9l-2 2H15v2H7.8l2 2-1.4 1.4L4 12l4.4-4.4z" /></Svg>;
export const LockIcon = () => <span className="lock-icon" title="Locked"><Svg size={12}><P d="M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z" /></Svg></span>;
export const WarnIcon = () => <Svg size={22}><P d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z" /></Svg>;
export const TrashIcon = () => <Svg size={22}><P d="M9 3h6l1 2h4v2H4V5h4l1-2zM5 9h14l-1 12H6L5 9zm4 2v8h2v-8H9zm4 0v8h2v-8h-2z" /></Svg>;
export const PauseIcon = () => <Svg size={22}><P d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 8h2v8H9V8zm4 0h2v8h-2V8z" /></Svg>;
export const InfoIcon = () => <Svg size={22}><P d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></Svg>;
export const CommentIcon = ({ size = 14 }) => <Svg size={size}><P d="M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4.3A2 2 0 0 1 3 15V5a2 2 0 0 1 2-2zm2 4v2h10V7H7zm0 4v2h7v-2H7z" /></Svg>;
export const StarIcon =() => <Svg><P d="M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z" /></Svg>;
