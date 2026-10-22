/**
 * Offre réelle qui a motivé l'issue #66 : Exotec, « Lead Solutions Engineer »,
 * publiée sur Workable avec `telecommuting: true` (donc `FULL_REMOTE`), mais
 * qui impose des déplacements chez les clients et au siège près de Lille.
 * Texte abrégé ; la phrase sur les déplacements est celle de l'annonce.
 */
export const EXOTEC_LEAD_SOLUTIONS_ENGINEER = {
  title: "Lead Solutions Engineer",
  companyName: "Exotec",
  city: "Lille",
  latitude: 50.6292,
  longitude: 3.0573,
  description: [
    "At Exotec, we put technological excellence at the service of redefining the relationship between humans and robots.",
    "As Lead Solutions Engineer, you will design warehouse automation solutions with our sales team and present them to prospects across Europe.",
    "You will lead a team of solutions engineers, build simulations of our Skypod system and size projects with Python and SQL.",
    "This position is remote, with travel: twice a month to visit our clients, once a month to our headquarters near Lille.",
    "Fluent English required; French is a plus.",
  ].join("\n"),
} as const;
