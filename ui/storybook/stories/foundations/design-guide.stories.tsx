import type { Meta, StoryObj } from "@storybook/react-vite";
import { DesignGuide } from "@/pages/DesignGuide";
const meta = { id: "design-system-design-guide", title: "Foundations/Design guide", component: DesignGuide, parameters: { layout: "fullscreen" } } satisfies Meta<typeof DesignGuide>;
export default meta;
export const Showcase: StoryObj<typeof meta> = {};
