export default function Button({ children, variant = "primary", type = "button", className = "", ...props }) {
  return (
    <button type={type} className={`button button--${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
