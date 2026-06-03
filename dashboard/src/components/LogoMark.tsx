import { Building2 } from 'lucide-react';
import type { UiConfig } from '../types';

export const LogoMark = ({ uiConfig }: { uiConfig: UiConfig }) => {
  if (uiConfig.logoUrl) {
    return (
      <img
        src={uiConfig.logoUrl}
        alt={`${uiConfig.brandName} logo`}
        className="h-10 w-10 rounded-lg object-cover"
      />
    );
  }

  return (
    <div
      className="p-2 bg-primary rounded-lg"
      role="img"
      aria-label={`${uiConfig.brandName} logo`}
    >
      <Building2 size={24} className="text-white" aria-hidden="true" />
    </div>
  );
};

export default LogoMark;
