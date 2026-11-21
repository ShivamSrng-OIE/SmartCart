import type { DetailedHTMLProps, HTMLAttributes } from "react";

// <model-viewer> custom element (https://modelviewer.dev), loaded on demand by ModelViewerModal.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        "ios-src"?: string;
        poster?: string;
        alt?: string;
        ar?: boolean | string;
        "ar-modes"?: string;
        "camera-controls"?: boolean | string;
        "auto-rotate"?: boolean | string;
        "auto-rotate-delay"?: string;
        "rotation-per-second"?: string;
        "shadow-intensity"?: string;
        exposure?: string;
        "environment-image"?: string;
        "touch-action"?: string;
        "interaction-prompt"?: string;
        loading?: "auto" | "lazy" | "eager";
        reveal?: "auto" | "manual";
      };
    }
  }
}
