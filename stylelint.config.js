export default {
  extends: [
    "stylelint-config-standard",
    "stylelint-config-recess-order",
  ],
  rules: {
    "property-no-vendor-prefix": [
      true,
      {
        ignoreProperties: [
          "-webkit-appearance",
          "-webkit-backdrop-filter",
        ],
      },
    ],
    "no-descending-specificity": null,
    "selector-class-pattern": "^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|cm-[A-Za-z][A-Za-z0-9-]*)$",
  },
};
