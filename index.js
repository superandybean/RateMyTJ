const express = require('express')
var cookieSession = require('cookie-session')
const {  AuthorizationCode } = require('simple-oauth2');
var https = require('https');
var hbs = require('hbs')
var mysql = require('mysql');
const { RSA_NO_PADDING } = require('constants');
const app = express()
const port = 3000

app.set('trust proxy', 1)

app.use(cookieSession({
  name: 'pogchamp',
  keys: ['urmomsdfasdfjdsfkasdf', 'pgpgofjsjfasdfjj']
}))

var TERMS = ["2018-2019 Summer", "2018-2019 Fall", "2018-2019 Spring", "2019-2020 Summer", "2019-2020 Fall", "2019-2020 Spring", "2020-2021 Summer", "2020-2021 Fall", "2020-2021 Spring"]

var ion_client_id = 'riogMOPcoOXJdwttjW3mfpM7J7EGagXPx7ebyIit'
var ion_client_secret = '2ImfFfzhxkuOBHEzNJmNh8gLLf5JKTsbrH2WR4uZly05srRwX5poVEgBqJxxOG4Vw1l2EVhPOlxI1xuczuZpVnrH8uMyFeXqiOEvTuLWEDYwuTBX76d7bqgeAQHWfRUg'
var ion_redirect_uri = 'http://localhost:3000/login_worker'

var client = new AuthorizationCode({
  client: {
    id: ion_client_id,
    secret: ion_client_secret,
  },
  auth: {
    tokenHost: 'https://ion.tjhsst.edu/oauth/',
    authorizePath: 'https://ion.tjhsst.edu/oauth/authorize',
    tokenPath: 'https://ion.tjhsst.edu/oauth/token/'
  }
})

var authorizationUri = client.authorizeURL({
  scope: "read",
  redirect_uri: ion_redirect_uri
});

// console.log(authorizationUri)

app.set('view engine', 'hbs')
app.use(express.static(__dirname + '/views'));

hbs.registerPartials(__dirname + '/views/partials')

hbs.registerHelper('fix_number', function(num) {
  if (num === undefined) return "";
  if (num == null) return "";
  return num.toFixed(2);
});

hbs.registerHelper('fix_number_profile', function(num) {
  if (num === undefined) return "";
  if (num == null) return "";
  if ((num+"").substring((num+"").indexOf(".")+1)) return num;
  return num.toFixed(2);
});

hbs.registerHelper('random_number', function(num) {
  var DIGITS = 6
  var s = Math.floor(Math.random() * 10 ** DIGITS) + ""
  while (s.length < DIGITS) s = '0' + s
  return s
});

hbs.registerHelper('format_date', function(d) {
  var s = d.toString()
  return s.substring(s.search(" ")+1, s.search("GMT")-1)
});

hbs.registerHelper('check_empty', function(s, options) {
  if (s === "") {
    return;
  }
  else {
    return options.fn(this)
  }
});

hbs.registerHelper('empty_key', function(k, options) {
  if (k === undefined) return options.fn(this)
  if (k.length == 0) {
    return options.fn(this)
  }
})

hbs.registerHelper('capitalize', function(s) {
  return (s.charAt(0)+"").toUpperCase() + s.substring(1)
})

hbs.registerHelper('display_bool', function(b) {
  return b ? "yes" : "no"
})

hbs.registerHelper('format_term', function(term) {
  if (term.indexOf(' ') == -1) {
    return "Full Year"
  }
  return term.substring(term.indexOf(' ')+1)
})

hbs.registerHelper('turn_to_ordinal', function(num) {
  var ones = num % 10
  var tens = num % 100
  if (ones == 1 && tens != 11) {
    return num + "st";
  }
  if (ones == 2 && tens != 12) {
    return num + "nd";
  }
  if (ones == 3 && tens != 13) {
    return num + "rd";
  }
  return num + "th";
})

function checkAuthentication(req, res, next) {
  if ('authenticated' in req.session) {
    next()
  }
  else {
    res.render('no_login', {"login_link": authorizationUri})
  }
}

function getProfileData(req,res,next) {
  if ('authenticated' in req.session) {

    var access_token = req.session.token.access_token;
    var profile_url = 'https://ion.tjhsst.edu/api/profile?format=json&access_token='+access_token;

    https.get(profile_url, function(response) {
      var rawData = '';
      response.on('data', function(chunk) {
          rawData += chunk;
      });

      response.on('end', function() {
        res.locals.profile = JSON.parse(rawData);
        res.locals.profile.exists = true
        next();
      });

    }).on('error', function(err) {
        next(err)
    });
  }
  else {
    next()
  }
}

async function convertCodeToToken(req, res, next) {
  var theCode = req.query.code;

  var options = {
      'code': theCode,
      'redirect_uri': ion_redirect_uri,
      'scope': 'read'
   };

  try {
      var accessToken = await client.getToken(options);
      res.locals.token = accessToken.token;
      next()
  }
  catch (error) {
      console.log('Access Token Error', error.message);
       res.send(502);
  }
}

var pool = mysql.createPool({
  user: 'root',
  password: 'asdf',
  host: '127.0.0.1',
  port: '3306',
  database: 'RateMyTJ'
})
var STATS = [["workload", "", "<="], ["difficulty","","<="], ["enjoyment", "DESC", ">="], ["teacher_score", "DESC", ">="], ["grade", "DESC", ">="]]

function get_class_info(req, res, next) {
  console.log('SELECT * FROM classes WHERE id="' + req.params.classID + '";')
  pool.query('SELECT * FROM classes WHERE id="' + req.params.classID + '";', function(error, results) {
    if (error) res.render('error');
    try {
      if (results.length != 1) {
        res.render('error')
      }
      else {
        res.locals.results = results[0]
        next()
      }
    } catch (error) {
      console.log(error)
      res.render('error')
    }
  })
}

function get_score_rank(req, res, next) {
  pool.query('SELECT name, RANK() OVER (ORDER BY class_score desc) ranking FROM classes WHERE class_score >= ' + res.locals.results.class_score + ' ORDER BY ranking', function(e,r) {
    res.locals.results.class_score_rank = r[r.length-1].ranking
    next()
  })
}

function get_total_classes(req, res, next) {
  pool.query('SELECT * FROM classes', function(e,r) {
    res.locals.results.num_classes = r.length
    next()
  })
}

function score_category(req, res, next) {
  pool.query('SELECT name, RANK() OVER (ORDER BY class_score desc) ranking FROM classes WHERE class_score >= ' + res.locals.results.class_score + ' AND category="' + res.locals.results.category + '" ORDER BY ranking', function(e,r) {
    res.locals.results.class_score_category_rank = r[r.length-1].ranking
    next()
  })
}

function num_category(req, res, next) {
  pool.query('SELECT * FROM classes WHERE category="' + res.locals.results.category + '";', function(e,r) {
    res.locals.results.num_category = r.length
    next()
  })
}

function avg_terms(req, res, next) {
  pool.query('SELECT term, AVG(class_score) AS avg_score, AVG(workload) AS avg_workload, AVG(difficulty) AS avg_difficulty, AVG(enjoyment) AS avg_enjoyment, AVG(teacher_score) AS avg_teacher_score, AVG(grade) AS avg_grade, COUNT(*) AS total FROM class_' + res.locals.results.id + ' GROUP BY term;', function(e,r) {
    res.locals.term_to_index = {}
    for (var i = 0; i < r.length; i++) {
      res.locals.term_to_index[r[i].term] = i
    }
    res.locals.term_stats = r
    next()
  })
}

function grade_num(req, res, next) {
  pool.query('SELECT term, COUNT(*) AS total FROM class_' + res.locals.results.id + ' WHERE grade >= 0 GROUP BY term;', function(e,r) {
    var total = 0
    for (var i = 0; i < r.length; i++) {
      res.locals.term_stats[res.locals.term_to_index[r[i].term]].grade_total = r[i].total
      total += r[i].total
    }
    res.locals.term_stats[res.locals.term_stats.length-1].grade_total = total
    next()
  })
}

function get_feedback(req, res, next) {
  pool.query('SELECT * FROM class_' + res.locals.results.id + ' WHERE NOT (feedback="");', function(e,r) {
    res.locals.feedback = r
    next()
  })
}

function median_score(req, res, next) {
  pool.query('SELECT term, class_score, ROW_NUMBER() OVER(PARTITION BY term ORDER BY class_score DESC) AS row_num FROM class_' + res.locals.results.id + ';', function(e,r) {
    // console.log(res.locals.term_to_index)
    var curr_ind = 0
    while (curr_ind < r.length) {
      var curr_term = r[curr_ind].term
      var total_nums = res.locals.term_stats[res.locals.term_to_index[curr_term]].total

      if (total_nums % 2 == 0) {
        res.locals.term_stats[res.locals.term_to_index[curr_term]].med_score = (r[curr_ind + Math.floor(total_nums/2)].class_score + r[(curr_ind + Math.floor(total_nums/2))-1].class_score) / 2
      }
      else {
        res.locals.term_stats[res.locals.term_to_index[curr_term]].med_score = r[curr_ind + Math.floor(total_nums/2)].class_score
      }

      curr_ind += total_nums
    }
    next()
  })
}

function avg_overall(req, res, next) {
  pool.query('SELECT term, AVG(class_score) AS avg_score, AVG(workload) AS avg_workload, AVG(difficulty) AS avg_difficulty, AVG(enjoyment) AS avg_enjoyment, AVG(teacher_score) AS avg_teacher_score, AVG(grade) AS avg_grade, COUNT(*) AS total FROM class_' + res.locals.results.id + ';', function(e,r) {
    var add = r[0]
    add.term = "Overall"
    res.locals.term_stats.push(add)
    next()
  })
}

function median_overall_score(req, res, next) {
  pool.query('SELECT term, class_score, ROW_NUMBER() OVER(ORDER BY class_score DESC) AS row_num FROM class_' + res.locals.results.id + ';', function(e,r) {
    if (r.length > 0) {
      if (r.length % 2 == 0) {
        res.locals.term_stats[res.locals.term_stats.length-1].med_score = (r[Math.floor(r.length/2)].class_score + r[Math.floor(r.length/2)-1].class_score) / 2
      }
      else {
        res.locals.term_stats[res.locals.term_stats.length-1].med_score = r[Math.floor(r.length/2)].class_score
      }
    }
    next()
  })
}

// SELECT teacher, term, class_score, ROW_NUMBER() OVER(PARTITION BY teacher,term ORDER BY class_score) AS row_term, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY term) AS row_teacher FROM class_2340T1;
function teacher_class_score(req, res, next) {
  pool.query('SELECT teacher, term, class_score, ROW_NUMBER() OVER(PARTITION BY teacher,term ORDER BY class_score) AS row_term, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY term) AS row_teacher FROM class_' + res.locals.results.id, function(e, r) {
    if (r.length > 0) {
      res.locals.teacher_to_index = {}
      var curr_index = 0
      var curr_teacher = r[0].teacher
      var curr_len = 0
      var dict_index = 0
      res.locals.term_teacher_to_index = {}
      res.locals.term_teacher_to_index[curr_teacher] = {}

      var curr_term = r[0].term
      var curr_term_len = 0
      var curr_term_index = 0
      var term_index = 0

      res.locals.teachers = [{"name": curr_teacher, "terms": []}]
      for (var i = 0; i < r.length; i++) {
        if (!(curr_term === r[i].term && curr_teacher === r[i].teacher)) {
          res.locals.term_teacher_to_index[curr_teacher][curr_term] = term_index
          if (curr_term_len % 2 == 0) {
            res.locals.teachers[dict_index].terms.push({"term": curr_term, "total": curr_term_len, "class_score": (r[curr_term_index + Math.floor(curr_term_len/2)].class_score + r[curr_term_index + Math.floor(curr_term_len/2)-1].class_score) / 2})
          }
          else {
            res.locals.teachers[dict_index].terms.push({"term": curr_term, "total": curr_term_len, "class_score": r[curr_term_index + Math.floor(curr_term_len/2)].class_score})
          }

          curr_term_len = 0
          curr_term_index = i
          curr_term = r[i].term
          term_index += 1
        }
        if (!(curr_teacher === r[i].teacher)) {
          res.locals.teacher_to_index[curr_teacher] = dict_index

          curr_len = 0
          curr_index = i
          dict_index += 1
          curr_teacher = r[i].teacher
          res.locals.teachers.push({"name": curr_teacher, "terms": []})
          res.locals.term_teacher_to_index[curr_teacher] = {}
          term_index = 0
        }
        curr_len += 1
        curr_term_len += 1
      }
      res.locals.teacher_to_index[curr_teacher] = dict_index
      res.locals.term_teacher_to_index[curr_teacher][curr_term] = term_index
      if (curr_term_len % 2 == 0) {
        res.locals.teachers[dict_index].terms.push({"term": curr_term, "total": curr_term_len, "class_score": (r[curr_term_index + Math.floor(curr_term_len/2)].class_score + r[curr_term_index + Math.floor(curr_term_len/2)-1].class_score) / 2})
      }
      else {
        res.locals.teachers[dict_index].terms.push({"term": curr_term, "total": curr_term_len, "class_score": r[curr_term_index + Math.floor(curr_term_len/2)].class_score})
      }
    }
    next()
  })
}

function overall_teacher_score(req, res, next) {
  pool.query('SELECT teacher, term, class_score, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY class_score) AS row_term FROM class_' + res.locals.results.id + ';', function(e, r) {
    if (r.length > 0) {
      var curr_index = 0
      var curr_teacher = r[curr_index].teacher
      while (curr_index < r.length) {
        curr_teacher = r[curr_index].teacher
        var total = 0
        for (var i = 0; i < res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length; i++) {
          total += res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[i].total
        }

        if (total % 2 == 0) {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.push({"term": "Overall", "total": total, "class_score": (r[curr_index + Math.floor(total/2)].class_score + r[curr_index + Math.floor(total/2)-1].class_score) / 2})
        }
        else {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.push({"term": "Overall", "total": total, "class_score": r[curr_index + Math.floor(total/2)].class_score})
        }

        curr_index += total
      }
    }
    next()
  })
}

//////// GENERIC CODE STARTS HERE
function get_stat_rank(stat, desc, arrow) {
  return function(req, res, next) {
    pool.query('SELECT name, RANK() OVER (ORDER BY ' + stat + ' ' + desc + ') ranking FROM classes WHERE ' + stat + ' ' + arrow + ' ' + res.locals.results[stat] + ' ORDER BY ranking', function(e,r) {
      res.locals.results[stat + "_rank"] = r[r.length-1].ranking
      next()
    })
  }
}

function stat_category(stat, desc, arrow) {
  return function(req, res, next) {
    pool.query('SELECT name, RANK() OVER (ORDER BY ' + stat + ' ' + desc + ') ranking FROM classes WHERE ' + stat + ' ' + arrow + ' ' + res.locals.results[stat] + ' AND category="' + res.locals.results.category + '" ORDER BY ranking', function(e,r) {
      res.locals.results[stat + "_category_rank"] = r[r.length-1].ranking
      next()
    })
  }
}

function median_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT term, ' + stat + ', ROW_NUMBER() OVER(PARTITION BY term ORDER BY ' + stat + ') AS row_num FROM class_' + res.locals.results.id + ';', function(e,r) {
      var curr_ind = 0
      while (curr_ind < r.length) {
        var curr_term = r[curr_ind].term
        var total_nums = res.locals.term_stats[res.locals.term_to_index[curr_term]].total

        if (total_nums % 2 == 0) {
          res.locals.term_stats[res.locals.term_to_index[curr_term]]["med_" + stat] = (r[curr_ind + Math.floor(total_nums/2)][stat] + r[(curr_ind + Math.floor(total_nums/2))-1][stat]) / 2
        }
        else {
          res.locals.term_stats[res.locals.term_to_index[curr_term]]["med_" + stat] = r[curr_ind + Math.floor(total_nums/2)][stat]
        }

        curr_ind += total_nums
      }
      next()
    })
  }
}

function teacher_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT teacher, term, ' + stat + ', ROW_NUMBER() OVER(PARTITION BY teacher,term ORDER BY ' + stat + ') AS row_term, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY term) AS row_teacher FROM class_' + res.locals.results.id, function(e, r) {
      if (r.length > 0) {
        var curr_index = 0
        var curr_teacher = r[0].teacher
        var curr_len = 0

        var curr_term = r[0].term
        var curr_term_len = 0
        var curr_term_index = 0

        for (var i = 0; i < r.length; i++) {
          if (!(curr_term === r[i].term && curr_teacher === r[i].teacher)) {
            if (curr_term_len % 2 == 0) {
              res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = (r[curr_term_index + Math.floor(curr_term_len/2)][stat] + r[curr_term_index + Math.floor(curr_term_len/2)-1][stat]) / 2
            }
            else {
              res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = r[curr_term_index + Math.floor(curr_term_len/2)][stat]
            }

            curr_term_len = 0
            curr_term_index = i
            curr_term = r[i].term
          }
          if (!(curr_teacher === r[i].teacher)) {
            curr_len = 0
            curr_index = i
            curr_teacher = r[i].teacher
          }
          curr_len += 1
          curr_term_len += 1
        }
        if (curr_term_len % 2 == 0) {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = (r[curr_term_index + Math.floor(curr_term_len/2)][stat] + r[curr_term_index + Math.floor(curr_term_len/2)-1][stat]) / 2
        }
        else {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = r[curr_term_index + Math.floor(curr_term_len/2)][stat]
        }
      }
      next()
    })
  }
}

function overall_teacher_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT teacher, term, ' + stat + ', ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY ' + stat + ') AS row_term FROM class_' + res.locals.results.id + ';', function(e, r) {
      if (r.length > 0) {
        var curr_index = 0
        var curr_teacher = r[curr_index].teacher
        while (curr_index < r.length) {
          curr_teacher = r[curr_index].teacher
          var total = 0
          for (var i = 0; i < res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length-1; i++) {
            total += res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[i].total
          }

          if (total % 2 == 0) {
            res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length-1][stat] = (r[curr_index + Math.floor(total/2)][stat] + r[curr_index + Math.floor(total/2)-1][stat]) / 2
          }
          else {
            res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length-1][stat] = r[curr_index + Math.floor(total/2)][stat]
          }

          curr_index += total
        }
      }
      next()
    })
  }
}

function median_overall_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT term, ' + stat + ', ROW_NUMBER() OVER(ORDER BY ' + stat + ') AS row_num FROM class_' + res.locals.results.id + ';', function(e,r) {
      if (r.length > 0) {
        if (r.length % 2 == 0) {
          res.locals.term_stats[res.locals.term_stats.length-1]["med_" + stat] = (r[Math.floor(r.length/2)][stat] + r[Math.floor(r.length/2)-1][stat]) / 2
        }
        else {
          res.locals.term_stats[res.locals.term_stats.length-1]["med_" + stat] = r[Math.floor(r.length/2)][stat]
        }
      }
      next()
    })
  }
}

// function do_stats_functions(req, res, next) {
//   for (var i = 0; i < STATS.length; i++) {
//     get_stat_rank(STATS[i][0], STATS[i][1], STATS[i][2])
//     stat_category(STATS[i][0], STATS[i][1], STATS[i][2])
//     median_stat(STATS[i][0])
//     teacher_stat(STATS[i][0])
//     overall_teacher_stat(STATS[i][0])
//     median_overall_stat(STATS[i][0])
//   }
//   next()
// }

//////// GENERIC CODE ENDS HERE

function teacher_grade_num(req, res, next) {
  pool.query('SELECT teacher, term, COUNT(*) AS total FROM class_' + res.locals.results.id + ' WHERE grade >= 0 GROUP BY term, teacher;', function(e ,r) {
    if (r.length > 0) {
      for (var i = 0; i < r.length; i++) {
        res.locals.teachers[res.locals.teacher_to_index[r[i].teacher]].terms[res.locals.term_teacher_to_index[r[i].teacher][r[i].term]].grade_total = r[i].total
      }
    }
    next()
  })
}

function teacher_grade_num_overall(req, res, next) {
  pool.query('SELECT teacher, COUNT(*) AS total FROM class_' + res.locals.results.id + ' WHERE grade >= 0 GROUP BY teacher;', function(e ,r) {
    if (r.length > 0) {
      for (var i = 0; i < r.length; i++) {
        res.locals.teachers[res.locals.teacher_to_index[r[i].teacher]].terms[res.locals.teachers[res.locals.teacher_to_index[r[i].teacher]].terms.length-1].grade_total = r[i].total
      }
    }
    next()
  })
}

function get_user_feedback(req, res, next) {
  // console.log('SELECT userfeedback.*, classes.name FROM userfeedback INNER JOIN classes ON userfeedback.class_id = classes.id WHERE user_id=' + res.locals.profile.id + ';')
  pool.query('SELECT userfeedback.*, classes.name FROM userfeedback INNER JOIN classes ON userfeedback.class_id = classes.id WHERE user_id=' + res.locals.profile.id + ';', function(e,r) {
    res.locals.review_term = {}
    for (var i = 0; i < r.length; i++) {
      if (!(r[i].term in res.locals.review_term)) {
        res.locals.review_term[r[i].term] = {"term": r[i].term, "reviews": []}
      }
      res.locals.review_term[r[i].term].reviews.push(r[i])
    }
    next()
  })
}

function get_classes(req, res, next) {
  pool.query('SELECT name, id FROM classes;', function(e, r) {
    res.locals.classes = r
    next()
  })
}

app.get('/login_worker', [convertCodeToToken], function(req, res) {
  req.session.authenticated = true;
  req.session.token = res.locals.token;

  res.redirect('/');
})

app.get('/logout', function (req, res) {
  delete req.session.authenticated;

  res.redirect('/');
})

var base_middleware = [get_class_info, get_total_classes, num_category, avg_terms, avg_overall, grade_num, get_feedback]
var score_middleware = [get_score_rank, score_category, median_score, teacher_class_score, overall_teacher_score, median_overall_score]
var workload_middleware = [get_stat_rank("workload", "", "<="), stat_category("workload", "", "<="), median_stat("workload"), teacher_stat("workload"), overall_teacher_stat("workload"), median_overall_stat("workload")]
var difficulty_middleware = [get_stat_rank("difficulty", "", "<="), stat_category("difficulty", "", "<="), median_stat("difficulty"), teacher_stat("difficulty"), overall_teacher_stat("difficulty"), median_overall_stat("difficulty")]
var enjoyment_middleware = [get_stat_rank("enjoyment", "DESC", ">="), stat_category("enjoyment", "DESC", ">="), median_stat("enjoyment"), teacher_stat("enjoyment"), overall_teacher_stat("enjoyment"), median_overall_stat("enjoyment")]
var teacher_score_middleware = [get_stat_rank("teacher_score", "DESC", ">="), stat_category("teacher_score", "DESC", ">="), median_stat("teacher_score"), teacher_stat("teacher_score"), overall_teacher_stat("teacher_score"), median_overall_stat("teacher_score")]
var grade_middleware = [get_stat_rank("grade", "DESC", ">="), stat_category("grade", "DESC", ">="), median_stat("grade"), teacher_stat("grade"), overall_teacher_stat("grade"), median_overall_stat("grade")]
var extra_grade_middleware = [teacher_grade_num, teacher_grade_num_overall]
var stats_middleware = workload_middleware.concat(difficulty_middleware).concat(enjoyment_middleware).concat(teacher_score_middleware).concat(grade_middleware)

app.get('/', [getProfileData], (req, res) => {
  pool.query("SELECT * FROM classes;", function(error, results) {
    // console.log(res.locals.profile)
    res.render('index', {"classes": results, "profile": res.locals.profile, "login_link": authorizationUri})
  })
})

app.get('/class/:classID', [getProfileData].concat(base_middleware).concat(score_middleware).concat(stats_middleware).concat(extra_grade_middleware), function (req, res) {
  // console.log(res.locals.results)
  // console.log(res.locals.term_stats)
  // console.log(res.locals.teachers)
  // console.log(res.locals.feedback)
  // console.log(res.locals["feedback"])
  res.render('classes', {"class_info": res.locals.results, "term_stats": res.locals.term_stats, "teacher": res.locals.teachers, "feedback": res.locals.feedback, "profile": res.locals.profile, "login_link": authorizationUri})
})

app.get('/profile', [checkAuthentication, getProfileData, get_user_feedback, get_classes], (req, res) => {
  // console.log(res.locals.review_term)
  // console.log(res.locals.classes)
  res.render('profile_page', {"profile": res.locals.profile, "reviews": res.locals.review_term, "classes": res.locals.classes, "terms": TERMS})
})

app.get('/submit_feedback', [checkAuthentication], (req, res) => {
  var class_name = req.params.class_name
  var class_id = req.params.class_id
  var review_time = new Date()
  var term = req.params.term
  var teacher = req.params.teacher
  var class_score = req.params.class_score
  var workload = req.params.workload
  var difficulty = req.params.difficulty
  var enjoyment = req.params.enjoyment
  var teacher_score = req.params.teacher_score
  var show_teacher = req.params.show_teacher
  var grade = req.params.grade
  var feedback = req.params.feedback

  res.redirect('/profile')
})

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
})
