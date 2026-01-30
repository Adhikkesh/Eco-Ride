# Eco-Ride

A comprehensive ride-sharing platform focused on eco-friendly transportation, built with modern web technologies.

## 🚀 Tech Stack

### Frontend (Web)
- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: TypeScript
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/), React Icons
- **Maps**: Google Maps API (@react-google-maps/api)
- **State/Data**: Firebase SDK

### Backend (Server)
- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Services**: Firebase Admin SDK
- **Geospatial**: GeoFire (for location-based queries)

### Database & Infrastructure
- **Database**: Firestore (NoSQL)
- **Authentication**: Firebase Auth
- **Monorepo Tool**: [Turborepo](https://turbo.build/)
- **Package Manager**: pnpm

### Developer Tools
- **Linting & Formatting**: [Biome](https://biomejs.dev/)

---

## 🛠️ How to Run

### Prerequisites
- Node.js (v18 or higher)
- pnpm (Package Manager)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd Eco-Ride
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up Environment Variables:**
   Create a `.env` file in `apps/web` and `apps/server` with the necessary API keys (Firebase, Google Maps, etc.).

4. **Run the Development Server:**
   To start both the frontend and backend concurrently:
   ```bash
   pnpm dev
   ```
   - The web application will be available at `http://localhost:3000`.
   - The server will run on its configured port (default likely 3001 or 4000).

5. **Build for Production:**
   ```bash
   pnpm build
   ```

6. **Linting & Formatting:**
   ```bash
   pnpm lint
   pnpm format
   ```

---

## 📊 System Diagrams

### Class Diagram
An overview of the system's object-oriented structure, including Users, Drivers, Rides, and Vehicles.

![Class Diagram](./assets/diagrams/class_diagram.png)

### ER Diagram (Entity-Relationship)
Visualizes the database schema, including users, ride requests, trips, transactions, and vehicle details within Firestore.

![ER Diagram](./assets/diagrams/er_diagram.png)

### Use Case Diagram
Illustrates the interactions between the primary actors (Rider, Driver, Admin) and the system's use cases.

![Use Case Diagram](./assets/diagrams/usecase_diagram.png)

### Time Sequence Diagram
Depicts the chronological sequence of interactions during a typical ride booking and execution flow.

![Sequence Diagram](./assets/diagrams/sequence_diagram.png)

---

## 📂 Project Structure

```
├── apps/
│   ├── web/           # Next.js Frontend Application
│   ├── server/        # Express Backend Server
│   └── mobile/        # Mobile Application (React Native/Expo)
├── packages/          # Shared packages (UI, config, etc.)
├── assets/            # Project diagrams and static assets
└── README.md          # Project Documentation
```

## 📜 License

This project is proprietary and confidential.
