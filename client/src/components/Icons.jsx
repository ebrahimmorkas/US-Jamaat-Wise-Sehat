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
export const StarIcon = () => <Svg><P d="M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z" /></Svg>;
