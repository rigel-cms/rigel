import { defineCopy } from "@rigel-cms/rigel/content";

export default defineCopy({
  slug: "contact",
  label: "Contact",
  groups: [
    {
      id: "intro",
      label: "Introduction",
      fields: [
        { key: "heading", type: "string", label: "Heading" },
        { key: "lead", type: "text", label: "Lead" },
      ],
    },
  ],
  values: {
    intro: {
      heading: "Start with a hello.",
      lead: "A new idea, a fresh direction, or just a conversation. We would love to hear it.",
    },
  },
});
