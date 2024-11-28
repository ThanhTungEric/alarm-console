const axios = require('axios');

const url = 'http://localhost:3008/api/sensor'; // Thay đổi địa chỉ URL nếu cần
const sensors = Array.from({ length: 402 }, (_, i) => `sensor ${i + 1}`); // Tạo 400 cảm biến duy nhất

const dataTemplate = {
    "sensor_state": "active",
    "acknowledgment_state": "none",
    "alarm_class": "warning",
    "priority": 1,
    "message": "2D.PP-CBS-DL2.2 disconnect.",
    "status": "new"
};

async function sendRequests() {
    const requests = sensors.map(sensor => {
        const data = {
            ...dataTemplate,
            sensor // Gán giá trị sensor duy nhất cho từng yêu cầu
        };
        return axios.post(url, data);
    });

    try {
        const responses = await Promise.all(requests);
        responses.forEach((response, index) => {
            console.log(`Request ${index + 1} (Sensor: ${sensors[index]}):`, response.data);
        });
    } catch (error) {
        console.error('Error sending requests:', error.message);
    }
}

sendRequests();
