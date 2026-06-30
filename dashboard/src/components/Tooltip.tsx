import React, { useId, useState } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  const handleShowTooltip = () => setVisible(true);
  const handleHideTooltip = () => setVisible(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={handleShowTooltip}
      onMouseLeave={handleHideTooltip}
    >
      {/* Wrap children to capture focus events */}
      <span onFocus={handleShowTooltip} onBlur={handleHideTooltip}>
        {typeof children === 'object' && children !== null && 'props' in children
          ? React.cloneElement(children as React.ReactElement, {
              'aria-describedby': visible ? tooltipId : undefined,
            })
          : children}
      </span>
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 shadow-lg"
        >
          {content}
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900"
          />
        </span>
      )}
    </span>
  );
};

export default Tooltip;
