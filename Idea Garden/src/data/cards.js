import { ideas } from "./ideas.js";

// Async data source for the idea cards. Today it returns the bundled static
// data from ideas.js; to load from a backend later, swap the body for a fetch()
// call (see the commented example) — callers already await this.
export async function getCards() {
    return ideas;

    // Example API-backed version:
    // const response = await fetch( "/api/cards" );
    // if ( !response.ok ) {
    //     throw new Error( `Failed to load cards: ${ response.status }` );
    // }
    // return await response.json();
}
