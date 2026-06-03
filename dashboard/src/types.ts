export type FieldRequirement = {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
};

export type UiConfig = {
  brandName: string;
  logoUrl?: string;
  primaryColor: string;
  accentColor: string;
  supportEmail?: string;
  fieldRequirements: {
    deposit: FieldRequirement[];
    withdraw: FieldRequirement[];
    kyc: FieldRequirement[];
  };
};
