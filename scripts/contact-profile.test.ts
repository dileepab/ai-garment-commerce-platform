import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractContactDetailsFromText,
  getMissingContactFields,
  mergeContactDetails,
} from '../src/lib/contact-profile.ts';

test('freeform address keeps street, city, and district separated', () => {
  const contact = extractContactDetailsFromText(
    '460/2, Temple Road, Bingiriya, Kurunegala'
  );

  assert.equal(contact.streetAddress, '460/2, Temple Road');
  assert.equal(contact.city, 'Bingiriya');
  assert.equal(contact.district, 'Kurunegala');
  assert.equal(contact.address, '460/2, Temple Road, Bingiriya, Kurunegala');
});

test('two-part street and district address asks for city instead of duplicating district', () => {
  const contact = extractContactDetailsFromText('12 Main Street, Kurunegala');

  assert.equal(contact.streetAddress, '12 Main Street');
  assert.equal(contact.city, '');
  assert.equal(contact.district, 'Kurunegala');
  assert.deepEqual(getMissingContactFields(contact), ['name', 'city', 'phone']);
});

test('labelled street correction does not split road name into city', () => {
  const current = {
    name: 'Dileepa',
    streetAddress: '460/2, Old Road',
    city: 'Bingiriya',
    district: 'Kurunegala',
    phone: '0702694270',
  };
  const updated = mergeContactDetails(
    current,
    extractContactDetailsFromText('Street Address: 460/2, Temple Road')
  );

  assert.equal(updated.streetAddress, '460/2, Temple Road');
  assert.equal(updated.city, 'Bingiriya');
  assert.equal(updated.district, 'Kurunegala');
  assert.equal(updated.address, '460/2, Temple Road, Bingiriya, Kurunegala');
});

test('single-line labelled details parse without leaking phone into address', () => {
  const contact = extractContactDetailsFromText(
    'Name: Amal, Street Address: 10 Temple Rd, City/Town: Colombo, District: Colombo, Phone Number: 0771112222'
  );

  assert.equal(contact.name, 'Amal');
  assert.equal(contact.streetAddress, '10 Temple Rd');
  assert.equal(contact.city, 'Colombo');
  assert.equal(contact.district, 'Colombo');
  assert.equal(contact.phone, '0771112222');
  assert.equal(contact.address, '10 Temple Rd, Colombo, Colombo');
});

test('sentence-style contact details preserve name and phone when address is parsed', () => {
  const contact = extractContactDetailsFromText(
    'Here is my info: Name is Dil, Address is 12 Main St, Colombo, phone is 0771234567'
  );

  assert.equal(contact.name, 'Dil');
  assert.equal(contact.streetAddress, '12 Main St');
  assert.equal(contact.city, '');
  assert.equal(contact.district, 'Colombo');
  assert.equal(contact.phone, '0771234567');
  assert.equal(contact.address, '12 Main St, Colombo');
});

test('confirmation phrases are never inferred as missing address fields', () => {
  const city = extractContactDetailsFromText('Yes, that is correct', 'city');
  const district = extractContactDetailsFromText('Yes confirm order', 'district');
  const naturalCity = extractContactDetailsFromText('Yes. Place it now.', 'city');
  const naturalDistrict = extractContactDetailsFromText(
    'Yes, confirm and place the order',
    'district'
  );

  assert.equal(city.city, '');
  assert.equal(city.address, '');
  assert.equal(district.district, '');
  assert.equal(district.address, '');
  assert.equal(naturalCity.city, '');
  assert.equal(naturalCity.address, '');
  assert.equal(naturalDistrict.district, '');
  assert.equal(naturalDistrict.address, '');
});

test('product selection text is never inferred as a comma-separated address', () => {
  const contact = extractContactDetailsFromText(
    'I want to order 1 Oversized Casual Top, size M, color Black.'
  );

  assert.equal(contact.streetAddress, '');
  assert.equal(contact.city, '');
  assert.equal(contact.district, '');
  assert.equal(contact.address, '');
});

test('an explicit delivery phrase still extracts an address from an order message', () => {
  const contact = extractContactDetailsFromText(
    'Please deliver my order to 12 Main Street, Nugegoda, Colombo'
  );

  assert.equal(contact.streetAddress, '12 Main Street');
  assert.equal(contact.city, 'Nugegoda');
  assert.equal(contact.district, 'Colombo');
  assert.equal(contact.address, '12 Main Street, Nugegoda, Colombo');
});

test('an explicit send phrase still extracts an address from an order message', () => {
  const contact = extractContactDetailsFromText(
    'Please send my order to 42 Test Lane, Negombo, Gampaha'
  );

  assert.equal(contact.streetAddress, '42 Test Lane');
  assert.equal(contact.city, 'Negombo');
  assert.equal(contact.district, 'Gampaha');
  assert.equal(contact.address, '42 Test Lane, Negombo, Gampaha');
});

test('order message keeps district, phone, and payment outside the delivery address', () => {
  const contact = extractContactDetailsFromText(
    'I want 1 Preview Linen Top, size M, black. My name is Nimal Perera. Deliver to 10 Temple Road, Colombo 03, Colombo District. Phone 0771234567. Cash on delivery.'
  );

  assert.equal(contact.name, 'Nimal Perera');
  assert.equal(contact.streetAddress, '10 Temple Road');
  assert.equal(contact.city, 'Colombo 03');
  assert.equal(contact.district, 'Colombo');
  assert.equal(contact.phone, '0771234567');
  assert.equal(contact.address, '10 Temple Road, Colombo 03, Colombo');
});
