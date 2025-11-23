Ext.define('pve-rrd-node', {
    extend: 'Ext.data.Model',
    fields: [
        {
            name: 'cpu',
            // percentage
            convert: function (value) {
                return value * 100;
            },
        },
        {
            name: 'iowait',
            // percentage
            convert: function (value) {
                return value * 100;
            },
        },
        'loadavg',
        'maxcpu',
        'memtotal',
        'memused',
        'netin',
        'netout',
        'roottotal',
        'rootused',
        'swaptotal',
        'swapused',
        'memavailable',
        'arcsize',
        'pressurecpusome',
        'pressureiosome',
        'pressureiofull',
        'pressurememorysome',
        'pressurememoryfull',
        { type: 'date', dateFormat: 'timestamp', name: 'time' },
    ],
});

Ext.define('pve-rrd-guest', {
    extend: 'Ext.data.Model',
    fields: [
        {
            name: 'cpu',
            // percentage
            convert: function (value) {
                return value * 100;
            },
        },
        'maxcpu',
        'netin',
        'netout',
        { name: 'mem', defaultValue: null },
        'maxmem',
        'disk',
        'maxdisk',
        'diskread',
        'diskwrite',
        'memhost',
        'pressurecpusome',
        'pressurecpufull',
        'pressureiosome',
        'pressurecpufull',
        'pressurememorysome',
        'pressurememoryfull',
        { type: 'date', dateFormat: 'timestamp', name: 'time' },
    ],
});

Ext.define('pve-rrd-storage', {
    extend: 'Ext.data.Model',
    fields: ['used', 'total', { type: 'date', dateFormat: 'timestamp', name: 'time' }],
});
