function SummaryCard({ label, value }) {
  return (
    <div className="summary-card">
      <span className="summary-label">
        {label}
      </span>

      <strong className="summary-value">
        {value}
      </strong>
    </div>
  )
}

export default SummaryCard