import { Toaster as Sonner } from "sonner";
import {
  Check,
  CircleAlert,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster badiyos-toaster"
      closeButton
      duration={3500}
      gap={8}
      icons={{
        success: <Check aria-hidden="true" />,
        info: <Info aria-hidden="true" />,
        warning: <TriangleAlert aria-hidden="true" />,
        error: <CircleAlert aria-hidden="true" />,
        loading: <LoaderCircle aria-hidden="true" className="animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "badiyos-toast",
          content: "badiyos-toast-content",
          title: "badiyos-toast-title",
          description: "badiyos-toast-description",
          icon: "badiyos-toast-icon",
          closeButton: "badiyos-toast-close",
          actionButton: "badiyos-toast-action",
          cancelButton: "badiyos-toast-cancel",
          success: "badiyos-toast-success",
          error: "badiyos-toast-error",
          warning: "badiyos-toast-warning",
          info: "badiyos-toast-info",
          loading: "badiyos-toast-loading",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
