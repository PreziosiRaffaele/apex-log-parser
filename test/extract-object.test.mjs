import assert from 'node:assert/strict';
import test from 'node:test';
import { extractObject } from '../dist/ParserUtils.js';

test('extractObject returns only the sObject after FROM', () => {
    const cases = [
        ['select id from search_match_configuration__mdt with system_mode limit 1', 'search_match_configuration__mdt'],
        ['SELECT Id FROM Account WHERE Name = :tmpVar1', 'account'],
        ['SELECT Id FROM Account WITH SECURITY_ENFORCED', 'account'],
        ['SELECT Id FROM Contact ORDER BY LastName LIMIT 10 OFFSET 5', 'contact'],
        ['SELECT Id FROM Contact LIMIT 10', 'contact'],
        ['SELECT Id FROM Contact OFFSET 5', 'contact'],
        ['SELECT COUNT(Id), StageName FROM Opportunity GROUP BY StageName', 'opportunity'],
        ['SELECT Id FROM Account LIMIT 1 FOR UPDATE', 'account'],
        ['SELECT Id FROM Account USING SCOPE mine', 'account'],
        ['SELECT a.Id FROM Account a WHERE a.Name != null', 'account'],
        ['SELECT Id\nFROM\n  ns__Custom_Object__c\nWHERE Id != null', 'ns__custom_object__c'],
        ['select id from account', 'account'],
        ['SELECT COUNT() FROM Lead', 'lead'],
    ];

    for (const [query, expected] of cases) {
        assert.equal(extractObject(query), expected, query);
    }
});

test('extractObject ignores FROM inside parenthesized subqueries', () => {
    assert.equal(extractObject('SELECT Id, (SELECT Id FROM Contacts) FROM Account'), 'account');
    assert.equal(
        extractObject('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact) LIMIT 5'),
        'account',
    );
    assert.equal(
        extractObject("SELECT Id, (SELECT Id FROM Cases WHERE Subject = 'x (from y') FROM Account"),
        'account',
    );
});

test('extractObject returns empty string without a top-level FROM', () => {
    assert.equal(extractObject(''), '');
    assert.equal(extractObject('SELECT Id'), '');
    assert.equal(extractObject('SELECT from__c'), '');
    assert.equal(extractObject('(SELECT Id FROM Account)'), '');
});
