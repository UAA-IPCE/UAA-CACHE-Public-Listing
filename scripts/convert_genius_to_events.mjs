// convert_genius_to_events.mjs
// Reads the extracted catalog JSON and produces a cleaned events list for static site use.
import fs from 'fs';
import path from 'path';

const inputPath = path.resolve('data/genius_catalog_affiliate_6Q68Q3.json');
const outputPath = path.resolve('data/events_genius_affiliate_6Q68Q3.json');

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/--+/g, '-');
}

function transformCourse(course) {
    return {
        title: course.CourseName || '',
        startDate: course.StartDate || course.FormatedStartDate || '',
        delivery: course.Delivery || '',
        seatsAvailable: course.CapAvailable ?? course.Cap ?? null,
        price: course.FormatedCost || course.Cost || '',
        registerUrl: `https://continuingstudies.alaska.edu/Registration.aspx?SectionID=${course.SectionIndex}`,
        slug: slugify(course.CourseName || `event-${course.SectionIndex}`),
        location: course.Location || '',
        teachers: course.Teachers || '',
        category: course.Category || '',
        description: course.Description || '',
        longDescription: course.LongDescription || '',
        available: course.AvailableForRegistration === 'True',
    };
}

function main() {
    const raw = fs.readFileSync(inputPath, 'utf8');
    const courses = JSON.parse(raw);
    const events = courses.map(transformCourse);
    fs.writeFileSync(outputPath, JSON.stringify(events, null, 2));
    console.log(`Saved events JSON to ${outputPath}`);
}

main();
