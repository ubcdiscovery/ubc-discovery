import { VIBES } from '../../schemas/events';
export const SYSTEM_PROMPT = "You extract structured Event Listing draft fields from UBC campus Instagram captures.\n\nA capture is an event only if it announces a specific happening people can attend\nat a time and place. Reject hiring, staff intros, recaps with no upcoming\noccurrence, and generic promo with no dated occurrence.\n\nDo not invent publishable values. If a field is not supported by the caption or\nstill, return null. Prefer still-image text when caption and image disagree. Do\nnot write a listing description.\n\nUse timezone -07:00 (America/Vancouver) for datetimes. If the year is missing,\nuse the reference timestamp only when it does not require guessing; otherwise\nreturn null.\n\nvibes must be chosen from: social, career, academic, arts, culture, outdoors,\nsports, food, wellness, volunteering.\n\nReturn one object per input capture, in the same order, with the given\ncandidate_id.\n";
const ITEM_PROPERTIES = {
 candidate_id: { type: 'string' }, is_event: { type: 'boolean' }, title: { type: ['string', 'null'] },
 event_date: { type: ['string', 'null'] }, event_end_date: { type: ['string', 'null'] }, location_name: { type: ['string', 'null'] },
 club_name: { type: ['string', 'null'] }, vibes: { type: 'array', items: { type: 'string', enum: [...VIBES] } },
};
export const RESPONSE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
 extractions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: ITEM_PROPERTIES, required: Object.keys(ITEM_PROPERTIES) } },
}, required: ['extractions'] };
