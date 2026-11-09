// A status is always shown with a coloured dot AND its text label.
export default function StatusPill({ status, tone }) {
  return (
    <span className={`pill ${tone}`}>
      <span className={`dot tone-${tone}`} />
      {status}
    </span>
  );
}
