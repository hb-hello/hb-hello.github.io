const htmlPreHeading = `<div class="timeline-block">
                    <div class="timeline-dot">
                        <i class="fa-solid fa-circle timeline-circle"></i>
                    </div>
                    <article>
                        <header><i class="fa-solid fa-calendar timeline-icon"></i><strong>`;

const htmlPostHeading = `</strong></header>
                        <p>`;

const htmlPostContent = `</p>
                    </article>
                </div>`;

 var converter = new Markdown.getSanitizingConverter();

window.addEventListener("load", () => {
    fetch('data/timeline.json')
        .then(response => response.json())
        .then(data => {
            JSON.parse(JSON.stringify(data));
            console.log(data);
            data.reverse().forEach(element => {
                date = element.date;
                content = converter.makeHtml(element.content);
                document.getElementById('timeline').innerHTML += htmlPreHeading + date + htmlPostHeading + content + htmlPostContent;
            });
        }).catch(error => console.error('Error loading JSON:', error));
});