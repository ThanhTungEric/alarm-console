const axios = require('axios');
// Hàm gọi API
const callApi = async (deviceId, deviceName, deviceType) => {
    let apiUrl;

    // Kiểm tra TYPE để xác định URL gọi API
    if (deviceType === 'Conveyor') {
        apiUrl = `http://${process.env.TOKEN}/api/states/sensor.i1_${deviceId}`;
    } else {
        apiUrl = `http://${process.env.TOKEN}/api/states/sensor.dcbusvoltage_${deviceId}`;
    }

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${process.env.TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const state = response.data.state;
        console.log(`Data for ${deviceName}:`, response.data);

        if (state === 'unavailable') {
            await handleUnavailableAlarm(deviceName);
        }
    } catch (error) {
        console.error(`Error calling API for ${deviceName}:`, error);
    }
};

// Hàm xử lý alarm khi trạng thái là unavailable
const handleUnavailableAlarm = async (deviceName) => {
    const checkSql = `
        SELECT * FROM alarm 
        WHERE sensor = ? AND (status = 'new' OR status = 'pending')
    `;
    
    db.query(checkSql, [deviceName], (err, results) => {
        if (err) {
            console.error('Error checking alarms:', err);
            return;
        }

        if (results.length > 0) {
            // Nếu có alarm với trạng thái new, cập nhật change_timestamps
            const updateSql = `
                UPDATE alarm 
                SET change_timestamps = JSON_ARRAY(JSON_OBJECT('time', NOW(), 'state', 'new'))
                WHERE sensor = ? AND status = 'new'
            `;
            db.query(updateSql, [deviceName], (err) => {
                if (err) {
                    console.error('Error updating alarm:', err);
                } else {
                    console.log(`Updated change_timestamps for alarm of ${deviceName}.`);
                }
            });
        } else {
            // Nếu không có alarm với trạng thái new, kiểm tra trạng thái khác
            const pendingSql = `
                SELECT * FROM alarm 
                WHERE sensor = ? AND status = 'pending'
            `;
            db.query(pendingSql, [deviceName], (err, pendingResults) => {
                if (err) {
                    console.error('Error checking pending alarms:', err);
                    return;
                }

                if (pendingResults.length > 0) {
                    // Nếu có alarm với trạng thái pending nhưng không phải unavailable, cập nhật thành done
                    const updateDoneSql = `
                        UPDATE alarm 
                        SET status = 'done' 
                        WHERE sensor = ? AND status = 'pending'
                    `;
                    db.query(updateDoneSql, [deviceName], (err) => {
                        if (err) {
                            console.error('Error updating alarm to done:', err);
                        } else {
                            console.log(`Updated alarm status to done for ${deviceName}.`);
                        }
                    });
                } else {
                    // Nếu không có alarm nào, tạo mới
                    const insertSql = `
                        INSERT INTO alarm (sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, change_timestamps) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(JSON_OBJECT('time', NOW(), 'state', 'new')))
                    `;
                    const values = [
                        deviceName,
                        'unavailable',
                        'none',
                        'default', // Có thể thay đổi nếu cần
                        1, // Priority
                        'Sensor is unavailable',
                        'new'
                    ];
                    db.query(insertSql, values, (err) => {
                        if (err) {
                            console.error('Error inserting new alarm:', err);
                        } else {
                            console.log(`Created new alarm for ${deviceName}.`);
                        }
                    });
                }
            });
        }
    });
};

// Hàm lấy danh sách thiết bị từ cơ sở dữ liệu
const getDevices = () => {
    return new Promise((resolve, reject) => {
        const sql = "SELECT DEVICE, NAME, TYPE FROM device"; // Lấy cả DEVICE, NAME và TYPE
        db.query(sql, (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results.map(row => ({ id: row.DEVICE, name: row.NAME, type: row.TYPE })));
        });
    });
};

// Hàm tự động gọi API cho từng thiết bị
const automateApiCalls = async () => {
    try {
        const devices = await getDevices();
        let index = 0;

        const interval = setInterval(() => {
            if (index < devices.length) {
                callApi(devices[index].id, devices[index].name, devices[index].type);
                index++;
            } else {
                clearInterval(interval);
                console.log('Finished calling API for all devices.');
                db.end(); // Đóng kết nối cơ sở dữ liệu
            }
        }, 5000); // Gọi API mỗi 5 giây
    } catch (error) {
        console.error('Error during automation:', error);
    }
};
module.exports = { automateApiCalls };