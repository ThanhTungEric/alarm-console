const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const moment = require('moment-timezone');
const app = express();
const PORT = 3008;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.set('view engine', 'ejs'); // Sử dụng EJS
app.set('views', path.join(__dirname, 'views')); // Đường dẫn tới thư mục views
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối đến MySQL
const db = mysql.createConnection({
    host: '172.30.33.2',
    user: 'homeassistant',
    password: 'dcs123456',
    database: 'homeassistant'
});

// const db = mysql.createConnection({
//     host: 'localhost',
//     user: 'root',
//     password: '123456789',
//     database: 'homeassistant'
// });

db.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL Database');
});


// API ghi dữ liệu
app.post('/api/sensor', (req, res) => {
    const { sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status } = req.body;
    const sql = 'INSERT INTO alarm (sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status) VALUES (?, ?, ?, ?, ?, ?, ?)';

    db.query(sql, [sensor, sensor_state, acknowledgment_state, alarm_class, priority, message, status], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: result.insertId });
    });
});

// API để lấy tổng số bản ghi
app.get('/api/sensor/count', (req, res) => {
    const date = req.query.date;
    const month = req.query.month;
    let sql = 'SELECT COUNT(*) as total FROM alarm WHERE timestamp >= NOW() - INTERVAL 30 DAY';

    if (date) {
        sql += ' WHERE DATE(timestamp) = ?';
    } else if (month) {
        sql += ' WHERE DATE_FORMAT(timestamp, "%Y-%m") = ?';
    }

    db.query(sql, [date || month], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ total: results[0].total });
    });
});

// API đọc dữ liệu với phân trang
// API đọc dữ liệu với phân trang và lọc theo ngày/tháng
app.get('/api/sensor', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const date = req.query.date;
    const month = req.query.month;
    const sensor = req.query.sensor; // Thêm tham số sensor

    let sql = 'SELECT * FROM alarm WHERE 1=1'; // Bắt đầu với điều kiện true

    if (date) {
        sql += ' AND DATE(timestamp) = ?';
    } else if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
    }

    if (sensor) {
        sql += ' AND sensor = ?'; // Thêm điều kiện cho sensor
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';

    const params = [date || month, sensor, limit, offset].filter(param => param !== undefined); // Lọc ra các tham số không có giá trị

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json(results);
    });
});




// API đọc dữ liệu theo ngày
app.get('/api/sensor/date', (req, res) => {
    const date = req.query.date;
    const sql = 'SELECT *, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp FROM alarm WHERE DATE(timestamp) = ?';

    db.query(sql, [date], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        // Tạo workbook và worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(results.map(row => ({
            ...row,
            timestamp: row.formatted_timestamp // Thay đổi tên cột nếu cần
        })));
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sensor Data');

        // Ghi file Excel
        const filePath = `alarm_${date}.xlsx`;
        XLSX.writeFile(workbook, filePath);

        // Gửi file cho client
        res.download(filePath, err => {
            if (err) {
                res.status(500).send({ error: 'Error downloading file' });
            }
        });
    });
});

// API đọc dữ liệu theo tháng
app.get('/api/sensor/month', (req, res) => {
    const month = req.query.month;
    const sql = 'SELECT *, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") as formatted_timestamp FROM alarm WHERE DATE_FORMAT(timestamp, "%Y-%m") = ?';

    db.query(sql, [month], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        // Tạo workbook và worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(results.map(row => ({
            ...row,
            timestamp: row.formatted_timestamp // Thay đổi tên cột nếu cần
        })));
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sensor Data');

        // Ghi file Excel
        const filePath = `alarm_${month}.xlsx`;
        XLSX.writeFile(workbook, filePath);

        // Gửi file cho client
        res.download(filePath, err => {
            if (err) {
                res.status(500).send({ error: 'Error downloading file' });
            }
        });
    });
});

////// status alarm --------------------------------------------------------------------------------------------
// API đọc dữ liệu với phân trang và lọc theo ngày/tháng, chỉ lấy trạng thái pending
app.get('/api/sensor/pending', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const date = req.query.date;
    const month = req.query.month;
    const sensor = req.query.sensor; // Thêm tham số sensor

    let sql = 'SELECT * FROM alarm WHERE status != "hide" AND timestamp >= NOW() - INTERVAL 30 DAY'; // Lấy những bản ghi không có trạng thái hide và trong 30 ngày gần nhất

    if (date) {
        sql += ' AND DATE(timestamp) = ?';
    } else if (month) {
        sql += ' AND DATE_FORMAT(timestamp, "%Y-%m") = ?';
    }

    if (sensor) {
        sql += ' AND sensor = ?'; // Thêm điều kiện cho sensor
    }

    // Thêm điều kiện lọc theo trạng thái
    if (sensor === 'new' || sensor === 'pending' || sensor === 'done') {
        sql += ' AND status = ?';
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';

    const params = [date || month, sensor, sensor === 'new' || sensor === 'pending' || sensor === 'done' ? sensor : undefined, limit, offset].filter(param => param !== undefined); // Lọc ra các tham số không có giá trị

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json(results);
    });
});


// API chuyển trạng thái từ new sang pending
app.put('/api/sensor/status/pending/:id', (req, res) => {
    const id = req.params.id;
    const sql = 'UPDATE alarm SET status = "pending", timestamp = NOW() WHERE id = ? AND status = "new"';

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
    const sql = 'UPDATE alarm SET status = "done", timestamp = NOW() WHERE sensor = ? AND status = "pending"';

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
    const sql = 'UPDATE alarm SET status = "hide" WHERE id = ? AND status = "done"';

    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi hoặc trạng thái đã xong.' });
        }
        res.json({ message: 'Trạng thái đã được cập nhật thành đã xong.' });
    });
});


// Route để render trang chính
app.get('/', (req, res) => {
    res.render('index'); // Render file index.ejs
});
app.get('/pending', (req, res) => {
    res.render('pending'); // Render file index.ejs
});

// Khởi động server
app.listen(PORT, '192.168.2.150' ,() => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// app.listen(PORT, () => {
//     console.log(`Server is running on http://localhost:${PORT}`);
// });
