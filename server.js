const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const moment = require('moment-timezone');
const app = express();
require('dotenv').config();

const PORT = 3008;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.set('view engine', 'ejs'); // Sử dụng EJS
app.set('views', path.join(__dirname, 'views')); // Đường dẫn tới thư mục views
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối đến MySQL
// const db = mysql.createConnection({
//     host: '172.30.33.2',
//     user: 'homeassistant',
//     password: 'dcs123456',
//     database: 'homeassistant'
// });

const db = mysql.createConnection({
    host: process.env.LOCAL_IP,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
});

db.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL Database');
});


// API ghi dữ liệu
app.post('/api/sensor', (req, res) => {
    const { sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status } = req.body;

    // Kiểm tra xem có bản ghi nào với sensor và trạng thái 'new', 'pending', hoặc 'done'
    const checkSql = 'SELECT * FROM alarm WHERE sensor = ? AND status IN ("new", "pending", "done")';

    db.query(checkSql, [sensor], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length > 0) {
            // Nếu có bản ghi, cập nhật trạng thái thành 'new' và xóa change_timestamps cũ
            const updateSql = `
                UPDATE alarm 
                SET 
                    sensor_state = ?, 
                    acknowledgment_state = "none",
                    alarm_class = ?, 
                    priority = ?, 
                    message = ?, 
                    status = "new", 
                    timestamp = NOW(),
                    change_timestamps = JSON_ARRAY(JSON_OBJECT('time', NOW(), 'state', 'new')) 
                WHERE sensor = ? AND status IN ("new", "pending", "done")`;

            db.query(updateSql, [sensor_state, alarm_class, priority, message, sensor], (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Trạng thái đã được cập nhật thành "new".' });
            });
        } else {
            // Nếu không có bản ghi phù hợp, thêm một bản ghi mới
            const insertSql = `
                INSERT INTO alarm (sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, change_timestamps) 
                VALUES (?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(JSON_OBJECT('time', NOW(), 'state', 'new')))`;

            db.query(insertSql, [sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status], (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ id: result.insertId });
            });
        }
    });
});

// API để lấy tổng số bản ghi
app.get('/api/sensor/count', (req, res) => {
    const date = req.query.date;
    const month = req.query.month;
    let sql = 'SELECT COUNT(*) as total FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY';

    if (date) {
        sql += ' AND DATE(timestamp) = ?';
    } else if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
    }

    db.query(sql, [date || month], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ total: results[0]?.total || 0 }); // Trả về 0 nếu không có kết quả
    });
});


// API đọc dữ liệu với phân trang
// API đọc dữ liệu với phân trang và lọc theo ngày/tháng
app.get('/api/sensor', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;
    const date = req.query.date;
    const month = req.query.month;
    const sensor = req.query.sensor;
    const status = req.query.status; // Thêm tham số status

    let sql = 'SELECT * FROM alarm WHERE 1=1';

    if (date) {
        sql += ' AND DATE(timestamp) = ?';
    } else if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
    }

    if (sensor) {
        sql += ' AND sensor = ?';
    }

    if (status) {
        sql += ' AND status = ?'; // Thêm điều kiện cho status
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';

    const params = [date || month, sensor, status, limit, offset].filter(param => param !== undefined);

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json(results);
    });
});


app.get('/api/sensor/export', (req, res) => {
    const date = req.query.date; // Ngày
    const month = req.query.month; // Tháng
    const sensor = req.query.sensor; // Cảm biến (nếu có)

    let sql;
    let params = [];

    if (date) {
        // Xuất theo ngày
        sql = 'SELECT sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp, change_timestamps FROM alarm WHERE DATE(timestamp) = ?';
        params.push(date);
    } else if (month) {
        // Xuất theo tháng
        sql = 'SELECT sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp, change_timestamps FROM alarm WHERE DATE_FORMAT(timestamp, "%Y-%m") = ?';
        params.push(month);
    } else {
        // Nếu không có bộ lọc nào, xuất tất cả dữ liệu
        sql = 'SELECT sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp, change_timestamps FROM alarm';
    }

    // Nếu có bộ lọc cảm biến, thêm điều kiện vào SQL
    if (sensor) {
        sql += ' WHERE sensor = ?';
        params.push(sensor);
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        const formattedResults = results.map(row => {
            // Phân tích dữ liệu change_timestamps
            let timestamps = [];
            if (typeof row.change_timestamps === 'string') {
                try {
                    timestamps = JSON.parse(row.change_timestamps);
                } catch (e) {
                    console.error("Error parsing change_timestamps:", e);
                }
            } else if (Array.isArray(row.change_timestamps)) {
                // Nếu change_timestamps là một mảng đối tượng, sử dụng nó trực tiếp
                timestamps = row.change_timestamps;
            }

            // Khởi tạo các giá trị cho các trạng thái
            let newTime = '', pendingTime = '', doneTime = '', hideTime = '';

            // Duyệt qua các trạng thái để lấy thời gian
            timestamps.forEach(item => {
                switch (item.state) {
                    case 'new':
                        if (!newTime) newTime = item.time; // Chỉ lấy lần đầu tiên
                        break;
                    case 'pending':
                        if (!pendingTime) pendingTime = item.time; // Chỉ lấy lần đầu tiên
                        break;
                    case 'done':
                        if (!doneTime) doneTime = item.time; // Chỉ lấy lần đầu tiên
                        break;
                    case 'hide':
                        if (!hideTime) hideTime = item.time; // Chỉ lấy lần đầu tiên
                        break;
                }
            });

            return {
                ...row,
                timestamp: row.formatted_timestamp,
                new_time: newTime,
                pending_time: pendingTime,
                done_time: doneTime,
                hide_time: hideTime,
            };
        });

        // Tạo workbook và worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(formattedResults);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sensor Data');

        // Tạo buffer từ workbook
        const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        // Đặt tên file và kiểu nội dung
        const fileName = date ? `alarm_${date}.xlsx` : month ? `alarm_${month}.xlsx` : 'alarm_all.xlsx';
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Gửi buffer cho client
        res.send(buffer);
    });
});



////// status alarm --------------------------------------------------------------------------------------------
// API đọc dữ liệu với phân trang và lọc theo ngày/tháng, chỉ lấy trạng thái pending
app.get('/api/sensor/pending', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;
    const date = req.query.date;
    const month = req.query.month;
    const status = req.query.status; 

    let sql = 'SELECT * FROM alarm WHERE status != "hide" AND timestamp >= NOW() - INTERVAL 30 DAY'; 

    const params = [];

    if (date) {
        sql += ' AND DATE(timestamp) = ?';
        params.push(date);
    }
    if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
        params.push(month);
    }
    if (status) { 
        sql += ' AND status = ?';
        params.push(status);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset); // Thêm limit và offset vào params

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json(results);
    });
});

// Export pending by date or month where status different hide
app.get('/api/sensor/pending/export', (req, res) => {
    const date = req.query.date; 
    const month = req.query.month; 
    const status = req.query.status;

    let sql;
    let params = [];

    // Xây dựng truy vấn SQL dựa trên các bộ lọc
    if (date) {
        sql = 'SELECT sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp, change_timestamps FROM alarm WHERE DATE(timestamp) = ? AND status != "hide"';
        params.push(date);
    } else if (month) {
        sql = 'SELECT sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp, change_timestamps FROM alarm WHERE DATE_FORMAT(timestamp, "%Y-%m") = ? AND status != "hide"';
        params.push(month);
    } else {
        sql = 'SELECT sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp, change_timestamps FROM alarm WHERE status != "hide"';
    }

    // Nếu có bộ lọc cảm biến, thêm điều kiện vào SQL
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        const formattedResults = results.map(row => {
            // Phân tích dữ liệu change_timestamps
            let timestamps = [];
            if (typeof row.change_timestamps === 'string') {
                try {
                    timestamps = JSON.parse(row.change_timestamps);
                } catch (e) {
                    console.error("Error parsing change_timestamps:", e);
                }
            } else if (Array.isArray(row.change_timestamps)) {
                timestamps = row.change_timestamps;
            }

            // Khởi tạo các giá trị cho các trạng thái
            let newTime = '', pendingTime = '', doneTime = '', hideTime = '';

            // Kiểm tra số lượng phần tử trong mảng timestamps
            if (timestamps.length <= 4) {
                // Duyệt qua các trạng thái để lấy thời gian
                timestamps.forEach(item => {
                    switch (item.state) {
                        case 'new':
                            if (!newTime) newTime = item.time; // Chỉ lấy lần đầu tiên
                            break;
                        case 'pending':
                            if (!pendingTime) pendingTime = item.time; // Chỉ lấy lần đầu tiên
                            break;
                        case 'done':
                            if (!doneTime) doneTime = item.time; // Chỉ lấy lần đầu tiên
                            break;
                        case 'hide':
                            if (!hideTime) hideTime = item.time; // Chỉ lấy lần đầu tiên
                            break;
                    }
                });
            }

            return {
                ...row,
                timestamp: row.formatted_timestamp,
                new_time: newTime,
                pending_time: pendingTime,
                done_time: doneTime,
                hide_time: hideTime,
            };
        });

        // Tạo workbook và worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(formattedResults);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sensor Data');

        // Tạo buffer từ workbook
        const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        // Đặt tên file và kiểu nội dung
        const fileName = date ? `pending_alarm_${date}.xlsx` : (month ? `pending_alarm_${month}.xlsx` : 'all.xlsx'); // Sửa ở đây
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Gửi buffer cho client
        res.send(buffer);
    });
});


//count stutatus khác hide và status = hide
app.get('/api/sensor/status/count', (req, res) => {
    let sqlpending = 'SELECT COUNT(*) as total FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY AND status != "hide"';
    let sqlhide = 'SELECT COUNT(*) as total FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY AND status = "hide"';
    db.query(sqlpending, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query(sqlhide, (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ totalpending: results[0]?.total || 0, totalhide: result[0]?.total || 0 });
        });
    });
});

app.get('/api/sensor/status/count/new', (req, res) => {
    let sql = 'SELECT COUNT(*) as total FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY AND status = "new"';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ totalpending: results[0]?.total || 0 });
    });
});


// Count pending by date or month where status different hide
app.get('/api/sensor/pending/count', (req, res) => {
    const date = req.query.date;
    const month = req.query.month;
    const status = req.query.status; // Lấy status từ query
    let sql = 'SELECT COUNT(*) as total FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY AND status != "hide"';
    
    const params = [];

    if (status) {
        sql += ' AND status = ?';
        params.push(status); // Thêm status vào params
    }
    if (date) {
        sql += ' AND DATE(timestamp) = ?';
        params.push(date); // Thêm date vào params
    } else if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
        params.push(month); // Thêm month vào params
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ total: results[0]?.total || 0 });
    });
});




// API chuyển trạng thái từ new sang pending
app.put('/api/sensor/status/pending/:id', (req, res) => {
    const id = req.params.id;
    const sql = `
        UPDATE alarm 
        SET 
            status = "pending", 
            acknowledgment_state = "yes", 
            timestamp = NOW(), 
            change_timestamps = JSON_ARRAY_APPEND(change_timestamps, '$', JSON_OBJECT('time', NOW(), 'state', 'pending')) 
        WHERE id = ? AND status = "new"`;

    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi hoặc trạng thái mới.' });
        }
        res.json({ message: 'Trạng thái đã được cập nhật.' });
    });
});


// API chuyển trạng thái từ pending sang done
app.put('/api/sensor/status/done', (req, res) => {
    const { sensor } = req.body; // Lấy sensor từ body
    const sql = `
        UPDATE alarm 
        SET 
            status = "done", 
            timestamp = NOW(), 
            change_timestamps = JSON_ARRAY_APPEND(change_timestamps, '$', JSON_OBJECT('time', NOW(), 'state', 'done')) 
        WHERE sensor = ? AND (status = "pending" OR status = "new")`;

    db.query(sql, [sensor], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi hoặc trạng thái đang làm.' });
        }
        res.json({ message: 'Trạng thái đã được cập nhật.' });
    });
});

// API chuyển trạng thái từ done sang hide
app.put('/api/sensor/status/hide/:id', (req, res) => {
    const id = req.params.id;
    const sql = `
        UPDATE alarm 
        SET 
            status = "hide", 
            timestamp = NOW(), 
            change_timestamps = JSON_ARRAY_APPEND(change_timestamps, '$', JSON_OBJECT('time', NOW(), 'state', 'hide')) 
        WHERE id = ? AND status = "done"`;

    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi hoặc trạng thái đã xong.' });
        }
        res.json({ message: 'Trạng thái đã được cập nhật thành đã xong.' });
    });
});

app.put('/api/sensor/status/pending', (req, res) => {
    // Cập nhật trạng thái "new" thành "pending" và "done" thành "hide" đồng thời
    const updateStatusSql = `
        UPDATE alarm 
        SET 
            status = CASE 
                WHEN status = "new" THEN "pending" 
                WHEN status = "done" THEN "hide" 
                ELSE status 
            END,
            acknowledgment_state = CASE 
                WHEN status = "new" THEN "yes" 
                WHEN status = "done" THEN "no" 
                ELSE acknowledgment_state 
            END,
            timestamp = NOW(),
            change_timestamps = JSON_ARRAY_APPEND(change_timestamps, '$', JSON_OBJECT('time', NOW(), 'state', 
                CASE 
                    WHEN status = "new" THEN "pending" 
                    WHEN status = "done" THEN "hide" 
                    ELSE status 
                END))
        WHERE status IN ("new", "done")`; // Thêm điều kiện WHERE để chỉ cập nhật các bản ghi có trạng thái "new" hoặc "done"

    db.query(updateStatusSql, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Đã cập nhật trạng thái: "new" thành "pending" và "done" thành "hide".' });
    });
});



// chuyển tất cả trạng thái từ done sang hide
app.put('/api/sensor/status/hide', (req, res) => {
    const sql = `
        UPDATE alarm 
        SET 
            status = "hide", 
            timestamp = NOW(), 
            change_timestamps = JSON_ARRAY_APPEND(change_timestamps, '$', JSON_OBJECT('time', NOW(), 'state', 'hide'))
        WHERE status = "done"`; // Thêm điều kiện WHERE để chỉ cập nhật các bản ghi có trạng thái "done"

    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi hoặc trạng thái đã xong.' });
        }
        res.json({ message: 'Trạng thái đã được cập nhật thành hide.' });
    });
});

app.put('/api/sensor/status/hide/v2', (req, res) => {
    const sql = `
        UPDATE alarm 
        SET 
            status = "hide"
        WHERE status = "pending"`; // Cập nhật các bản ghi có trạng thái "done" hoặc "pending"

    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi hoặc trạng thái đã xong.' });
        }
        res.json({ message: 'Trạng thái đã được cập nhật thành hide.' });
    });
});


// lấy dnah sách theo sensor
app.get('/api/sensor/dpm', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;
    const date = req.query.date;
    const month = req.query.month;
    const sensor = req.query.sensor; // Thêm tham số sensor

    let sql = 'SELECT * FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY'; 

    if (date) {
        sql += ' AND DATE(timestamp) = ?';
    } else if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
    }

    // Thêm điều kiện lọc theo sensor
    if (sensor) {
        sql += ' AND sensor = ?'; // Thêm điều kiện cho sensor
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';

    // Tạo danh sách tham số
    const params = [
        date || month,
        sensor, // Chỉ cần sensor đơn lẻ
        limit,
        offset
    ].filter(param => param !== undefined); // Lọc ra các tham số không có giá trị

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json(results);
    });
});

// Endpoint để lấy thông tin alarm theo ID
app.get('/api/alarm/:id', (req, res) => {
    const alarmId = req.params.id;
    const sql = 'SELECT * FROM alarm WHERE id = ?';

    db.query(sql, [alarmId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'Không tìm thấy alarm' });

        res.json(results[0]); // Trả về alarm đầu tiên
    });
});

// API để thêm hoặc cập nhật sensor
app.post('/api/historyview', (req, res) => {
    const { sensor } = req.body;

    if (!sensor) {
        return res.status(400).send('Sensor is required');
    }

    const currentTime = new Date();

    // Kiểm tra xem sensor đã tồn tại chưa
    const checkSql = 'SELECT * FROM historyview WHERE sensor = ?';
    db.query(checkSql, [sensor], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            // Nếu sensor chưa có, thêm mới
            const insertSql = 'INSERT INTO historyview (sensor, timestamp) VALUES (?, ?)';
            db.query(insertSql, [sensor, currentTime], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                return res.status(201).json({ message: 'Sensor added successfully' });
            });
        } else {
            // Nếu sensor đã có, cập nhật thời gian
            const updateSql = 'UPDATE historyview SET timestamp = ? WHERE sensor = ?';
            db.query(updateSql, [currentTime, sensor], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                return res.status(200).json({ message: 'Sensor updated successfully' });
            });
        }
    });
});

app.get('/api/latest-alarm', (req, res) => {
    // Truy vấn sensor mới nhất từ bảng historyview
    const latestSensorSql = 'SELECT sensor FROM historyview ORDER BY timestamp DESC LIMIT 1';
    
    db.query(latestSensorSql, (err, sensorResults) => {
        if (err) return res.status(500).json({ error: err.message });

        // Kiểm tra xem có kết quả không
        if (sensorResults.length === 0) {
            return res.status(404).json({ message: 'No sensors found' });
        }

        const latestSensor = sensorResults[0].sensor;

        // Sử dụng sensor mới nhất để truy vấn dữ liệu từ bảng alarm
        const alarmSql = 'SELECT * FROM alarm WHERE sensor = ? ORDER BY timestamp DESC';
        db.query(alarmSql, [latestSensor], (err, alarmResults) => {
            if (err) return res.status(500).json({ error: err.message });

            // Render file onepage.ejs với dữ liệu
            res.render('onpage', {
                sensor: latestSensor,
                data: alarmResults,
                appName: process.env.LOCAL_IP
            });
        });
    });
});


// Route để render trang chính
app.get('/', (req, res) => {
    res.render('index', { appName: process.env.LOCAL_IP }); // Render file index.ejs
});
app.get('/pending', (req, res) => {
    res.render('pending', { appName: process.env.LOCAL_IP }); // Render file index.ejs
});

app.get('/historydetail', (req, res) => {
    const sensor = req.query.sensor;

    // Kiểm tra xem sensor có được truyền không
    if (!sensor) {
        return res.status(400).send('Sensor is required');
    }

    // Truy vấn dữ liệu từ cơ sở dữ liệu theo sensor
    const sql = 'SELECT * FROM alarm WHERE sensor = ? ORDER BY timestamp DESC';
    db.query(sql, [sensor], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        // Render dữ liệu vào historydpm.ejs
        res.render('historydetail', { 
            sensor, 
            data: results, 
            appName: process.env.LOCAL_IP // Chuyển appName vào cùng đối tượng
        });
    });
});

// Khởi động server
app.listen(PORT, process.env.LOCAL_IP ,() => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// app.listen(PORT, () => {
//     console.log(`Server is running on http://localhost:${PORT}`);
// });
