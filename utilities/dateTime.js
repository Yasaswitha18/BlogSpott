module.exports = {
    convertDateTimeFormat: dateTime => {
        const inputDate = new Date(dateTime);
        const day = inputDate.getDate().toString().padStart(2, "0");
        const month = (inputDate.getMonth() + 1).toString().padStart(2, "0");
        const year = inputDate.getFullYear();
        const formattedDateString = `${day}/${month}/${year}`;
        return formattedDateString;
    },
    getMonthsVsBlogCount: () => {
        return [
            { month: 1, count: 0 },
            { month: 2, count: 0 },
            { month: 3, count: 0 },
            { month: 4, count: 0 },
            { month: 5, count: 0 },
            { month: 6, count: 0 },
            { month: 7, count: 0 },
            { month: 8, count: 0 },
            { month: 9, count: 0 },
            { month: 10, count: 0 },
            { month: 11, count: 0 },
            { month: 12, count: 0 },
        ]
    }
}