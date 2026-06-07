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

  assert.equal(city.city, '');
  assert.equal(city.address, '');
  assert.equal(district.district, '');
  assert.equal(district.address, '');
});
