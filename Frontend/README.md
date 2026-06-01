## Frontend (React + JavaScript)

This frontend is implemented with React.js and JavaScript (JS/JSX) using Vite.

### Scope

- UI shell and views for:
  - Dashboard
  - Faculty
  - Subjects
  - Rooms
  - Schedule
- Client-side interactions and page transitions.

### Faculty Teaching Record

- The Faculty preference modal shows the teaching record from the current selected tags.
- The list under the current tags section is backed by `faculty_subject_tags`.
- Removing an item from that list removes the corresponding selected tag.

### Faculty Preference Records

- The modal also shows an archive table of saved preference records below the current tags list.
- Each record can be deleted from the archive or re-added to the selected tags.

### Stack Alignment

- Language: JavaScript (no TypeScript files)
- Framework: React.js
- Build Tool: Vite
- Styling: Tailwind CSS

For overall architecture standards, see `STACK_GUIDELINES.md` in the repository root.

