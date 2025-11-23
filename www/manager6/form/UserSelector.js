Ext.define('pmx-users', {
    extend: 'Ext.data.Model',
    fields: [
        'userid',
        'firstname',
        'lastname',
        'email',
        'comment',
        { type: 'boolean', name: 'enable' },
        { type: 'date', dateFormat: 'timestamp', name: 'expire' },
    ],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/access/users?full=1',
    },
    idProperty: 'userid',
});
