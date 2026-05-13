#!/usr/bin/env node
import fs from 'fs'

const url = process.argv[2] || 'https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3'

console.log('Fetching', url)
const res = await fetch(url)
const text = await res.text()

// Find the array immediately preceding "var programsJson" and extract it.
const marker = '];var programsJson'
const markerIdx = text.indexOf(marker)
if (markerIdx === -1) {
    console.error('Could not find programsJson marker in page')
    process.exit(2)
}
const coursesVarIdx = text.indexOf('coursesJson')
if (coursesVarIdx === -1) {
    console.error('Could not find coursesJson variable in page')
    process.exit(2)
}
const eqIdx = text.indexOf('=', coursesVarIdx)
if (eqIdx === -1 || eqIdx > markerIdx) {
    console.error('Could not find assignment for coursesJson before programsJson')
    process.exit(2)
}
const startIdx = text.indexOf('[', eqIdx)
if (startIdx === -1 || startIdx > markerIdx) {
    console.error('Could not find start of array for coursesJson')
    process.exit(2)
}
const jsonText = text.slice(startIdx, markerIdx + 1)
// write a small debug snapshot to file so we can inspect if parsing fails
try { fs.writeFileSync('/tmp/extracted_genius_snippet.txt', jsonText.slice(0, 2000)) } catch (e) { }
console.error('extracted snippet written to /tmp/extracted_genius_snippet.txt')

// Attempt to parse; if trailing commas exist, try a simple cleanup and parse again.
let data
try {
    // The page stores a JS array; try evaluating it as JS to handle embedded HTML safely.
    data = Function('"use strict"; return (' + jsonText + ')')()
} catch (err) {
    try {
        // Fallback: attempt to clean trailing commas and parse as JSON
        const cleaned = jsonText.replace(/,\s*(?=[}\]])/g, '')
        data = JSON.parse(cleaned)
    } catch (err2) {
        console.error('Failed to parse or evaluate extracted array:', err.message, err2 ? err2.message : '')
        process.exit(3)
    }
}

console.log(JSON.stringify(data, null, 2))
