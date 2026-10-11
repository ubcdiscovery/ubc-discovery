# Academic onboarding options research

Date: 2026-09-02

## Question

What should UBC Discovery use as the source of truth for the faculty/school and
major/program fields in onboarding, and which input model keeps those fields
accurate without making the option lists unwieldy?

## Recommendation

For the current product, use a **UBC Vancouver** dataset and say so in the
field help text. Make faculty/school a searchable, closed single-select with an
`Other UBC faculty or school` fallback.

Make the second field a searchable **editable combobox**:

- label it `Program or major`;
- suggest a manually curated list of primary undergraduate programs for the
  selected faculty/school;
- include `Undeclared / not yet selected`;
- allow the member to type a value that is not in the suggestions; and
- omit combined and dual-degree variants from the suggestions, but continue to
  accept them as typed answers.

This is the useful middle ground between unrestricted text and a closed program
dropdown. It produces normalized values for common answers without claiming
that a deliberately shortened list represents every valid UBC specialization.
It also avoids silently converting a combined or double major into something
the member did not say.

Keep the stable option IDs and display data in frontend constants rather than
adding a runtime lookup endpoint. The backend is still the persistence source
of truth: its request schema validates the closed faculty/school and academic
level ID sets, and database check constraints protect those values outside the
API. Record stable machine IDs separately from display labels so a future
display-name change does not require migrating stored profiles.

Keep `Program or major` as normalized free text. The backend trims it, rejects
empty strings and values longer than 255 characters, but does not constrain it
to the curated suggestions or enforce a faculty/program pairing. This preserves
valid combined, joint, new, and cross-faculty programs that are intentionally
absent from the short suggestion list.

## Scope: campus must not be implicit

UBC Vancouver and UBC Okanagan have different faculties and schools. UBC
Okanagan's official directory says the campus has nine faculties and schools,
with names such as the Irving K. Barber Faculty of Arts and Social Sciences,
Faculty of Creative and Critical Studies, and Faculty of Management. These are
not aliases for Vancouver's Faculty of Arts or UBC Sauder School of Business.

The existing `FACULTIES` constant is a Vancouver-oriented list, and the
product does not currently ask for campus. The smallest consistent change is
therefore to document and display this as a Vancouver list. If UBC Discovery is
intended to serve both campuses, add `campus` as a first-class selection before
faculty/school and maintain separate option trees. Do not merge Vancouver and
Okanagan units into one flat list.

Sources:

- [Faculties & Schools at UBC's Vancouver Campus](https://www.ubc.ca/our-campuses/vancouver/directories/faculties-schools.html)
- [Faculties and Schools - UBC Okanagan](https://ok.ubc.ca/academics/faculties-and-schools/)

## Recommended Vancouver faculty/school options

UBC's Vancouver directory is the authoritative organizational directory, but
it is not itself a student-program list. It includes graduate-only schools,
departments, and Extended Learning, and it exposes some schools both on their
own and under a parent faculty. The student-facing list should retain units
that own or visibly identify an undergraduate program, while preserving the
parent relationship in data.

| Stable ID | Display label | Parent or search aliases |
| --- | --- | --- |
| `applied-science` | Faculty of Applied Science (Engineering) | Engineering, APSC |
| `architecture-landscape-architecture` | School of Architecture and Landscape Architecture | Applied Science, SALA |
| `arts` | Faculty of Arts | Arts |
| `sauder` | UBC Sauder School of Business | Business, Commerce, BCom |
| `dentistry` | Faculty of Dentistry | Dentistry |
| `education` | Faculty of Education | Education |
| `forestry-environmental-stewardship` | Faculty of Forestry and Environmental Stewardship | Forestry |
| `kinesiology` | School of Kinesiology | Education, KIN |
| `land-food-systems` | Faculty of Land and Food Systems | LFS |
| `law` | Peter A. Allard School of Law | Allard, Law |
| `medicine` | Faculty of Medicine | Medicine |
| `music` | School of Music | Arts, Music |
| `nursing` | School of Nursing | Applied Science, Nursing |
| `pharmaceutical-sciences` | Faculty of Pharmaceutical Sciences | Pharmacy, PharmSci |
| `science` | Faculty of Science | Science |
| `social-work` | School of Social Work | Arts, Social Work |
| `vantage-college` | UBC Vantage College | Vantage |
| `vancouver-school-economics` | Vancouver School of Economics | Arts, Economics, VSE |

Add `Other UBC faculty or school` as a product fallback, not as a UBC unit.

This list intentionally excludes Graduate and Postdoctoral Studies and units
whose current Calendar offerings are graduate-only. It includes professional
undergraduate-level programs such as Law, Medicine, and Dentistry because the
UBC Calendar classifies programs under those units as undergraduate. It also
includes Vantage College even though it is a pathway rather than a degree-owning
faculty, because it is a distinct current undergraduate cohort.

The parent relationships matter. For example, UBC's directory places Nursing
and the School of Architecture and Landscape Architecture under Applied
Science; Music, Social Work, and the Vancouver School of Economics under Arts;
and Kinesiology under Education. A flat UI may still show these as peer choices
because that is how students commonly identify, but the data should not imply
that they are all institutionally equivalent “faculties.” `Faculty or school`
is the accurate field label.

Sources:

- [UBC Vancouver faculties and schools directory](https://www.ubc.ca/our-campuses/vancouver/directories/faculties-schools.html)
- [UBC Vancouver Academic Calendar: Academic Programs](https://vancouver.calendar.ubc.ca/academic-programs)
- [School of Architecture and Landscape Architecture: Bachelor of Design](https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/school-architecture-and-landscape-architecture/bachelor-design-architecture-landscape-architecture-and-urbanism)
- [UBC Vantage College: Program Requirements](https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/ubc-vantage-college/program-requirements)

## Program/major source and curation policy

Use two first-party UBC sources for different purposes:

1. The [UBC Undergraduate Programs and Admissions program finder](https://you.ubc.ca/programs/)
   is the best seed for concise, student-recognizable suggestions. It already
   supports search and campus/degree filtering and is a useful precedent for
   the proposed interaction.
2. The [UBC Vancouver Academic Calendar Academic Programs table](https://vancouver.calendar.ubc.ca/academic-programs)
   is the source of record for a program's official name, owning faculty or
   school, and undergraduate/graduate level. Use the linked faculty or degree
   Calendar page to resolve ambiguous cases.

Do not mechanically copy every `Undergraduate` row from the Calendar. That
table mixes majors with minors, certificates, diplomas, first-year programs,
professional programs, combined majors, and even Medicine department headings.
For example, it includes `African Studies (Minor)`, `Accounting (Diploma)`,
`Arts One`, `Combined Major in Science`, and `Anesthesia` as undergraduate
rows. Those are valid Calendar entries but not a coherent list of primary
majors.

Apply these manual inclusion rules to each faculty/school:

- Include a current primary undergraduate program, major, or direct-entry
  professional program that a member would reasonably use as their main field
  of study.
- Prefer the public name used in the admissions finder, then confirm its
  official ownership and status in the Calendar.
- Keep degree qualifiers only where they disambiguate genuinely different
  programs, such as `Computer Science (B.A.)` and `Computer Science (B.Sc.)`.
- Exclude minors, certificates, diplomas, honours variants, concentrations,
  streams, first-year cohort programs, combined majors, double majors, and dual
  degrees from the suggestion list.
- Do not exclude valid custom answers. A member in a combined major, double
  major, new program, or unusual specialization must still be able to type the
  accurate value.
- Do not infer or enforce that the selected faculty and program are a perfect
  one-to-one pair. UBC has cross-faculty and joint programs.

Review the hardcoded list once per academic year against those pages. This is a
small editorial update; no scraper or runtime fetch is warranted.

## Why a closed major dropdown is not correct

UBC defines a program as the student's area of academic focus and a degree as
the bachelor's designation earned at graduation. It also says that, for most
degrees, students do not commit to a program until second or third year.
`Undeclared / not yet selected` is therefore a real state, not an error or an
`Other` value.

UBC Arts and Science also distinguish:

- a major in one field;
- a combined major that combines requirements from fields into one
  specialization;
- a double major consisting of two specializations; and
- a minor, which is a smaller concentration alongside a major or honours
  specialization.

Consequently, excluding combined majors from a closed dropdown would make the
form reject a valid academic identity. Excluding them only from suggestions is
reasonable for list length as long as free text remains available. If the
product instead asks a combined-major student to select one simplified subject,
rename the field to `Primary field of study` and document that it is a UBC
Discovery categorization rather than the member's official UBC program.

Sources:

- [UBC Undergraduate Programs and Admissions: Choose what to study](https://you.ubc.ca/applying-ubc/how-to-apply/degrees-programs/)
- [UBC Arts Calendar: Degree Program Options](https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/degree-program-options)
- [UBC Science Calendar: Introduction to Degree Options](https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/introduction-degree-options)
- [UBC Science: Degree Types](https://science.ubc.ca/students/degree-types)

## Interaction and validation notes

- Search should match display labels and familiar aliases (`Sauder`, `SALA`,
  `VSE`, `LFS`, `engineering`) case-insensitively.
- The faculty/school control should retain native keyboard expectations: type
  to filter, arrow through results, Enter to select, and Escape to close.
- Program suggestions should filter after a faculty/school selection, but a
  typed custom answer should not be rejected or silently erased.
- Existing saved strings must remain displayable and editable even if they are
  no longer in the current constants.
- Use the same data and input semantics in onboarding and profile editing so a
  value accepted during onboarding does not become invalid later.
- Keep both questions optional, as they are now. Do not require a program merely
  because a faculty/school was selected.
- Test exact option rendering, alias search, keyboard selection, empty and
  undeclared states, custom values, restoring a draft, editing a legacy value,
  and changing faculty after entering a program.

## Okanagan expansion reference

If campus support is added later, use the Okanagan sources independently. The
official Okanagan directory currently lists nine organizational entries,
including the graduate college, while the Calendar's undergraduate rows use
the owner labels Applied Science, Arts and Social Sciences, Creative and
Critical Studies, Education, Health and Social Development, Management, and
Science. The Okanagan degrees/programs page is the more readable seed list, and
the Okanagan Calendar remains the source of record.

Sources:

- [UBC Okanagan: Faculties and Schools](https://ok.ubc.ca/academics/faculties-and-schools/)
- [UBC Okanagan: Degrees and Programs](https://ok.ubc.ca/academics/degrees-and-programs/)
- [UBC Okanagan Academic Calendar: Academic Programs](https://okanagan.calendar.ubc.ca/academic-programs)

## Source record

All sources below were accessed on 2026-09-02:

- The University of British Columbia, “Faculties & Schools at UBC's Vancouver
  Campus”: https://www.ubc.ca/our-campuses/vancouver/directories/faculties-schools.html
- UBC Vancouver Academic Calendar, “Academic Programs”:
  https://vancouver.calendar.ubc.ca/academic-programs
- UBC Undergraduate Programs and Admissions, “Programs”:
  https://you.ubc.ca/programs/
- UBC Undergraduate Programs and Admissions, “Choose what to study”:
  https://you.ubc.ca/applying-ubc/how-to-apply/degrees-programs/
- UBC Vancouver Academic Calendar, “Degree Program Options” (Arts):
  https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/degree-program-options
- UBC Vancouver Academic Calendar, “Introduction to Degree Options” (Science):
  https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/introduction-degree-options
- UBC Science, “Degree Types: Majors, Combined Majors, Honours, and More”:
  https://science.ubc.ca/students/degree-types
- UBC Okanagan, “Faculties and Schools”:
  https://ok.ubc.ca/academics/faculties-and-schools/
- UBC Okanagan, “Degrees and Programs”:
  https://ok.ubc.ca/academics/degrees-and-programs/
- UBC Okanagan Academic Calendar, “Academic Programs”:
  https://okanagan.calendar.ubc.ca/academic-programs
