Ext.define('PVE.form.hashAlgorithmSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveHashAlgorithmSelector'],
    config: {
        deleteEmpty: false,
    },
    comboItems: [
        ['__default__', 'None'],
        ['md5', 'MD5'],
        ['sha1', 'SHA-1'],
        ['sha224', 'SHA-224'],
        ['sha256', 'SHA-256'],
        ['sha384', 'SHA-384'],
        ['sha512', 'SHA-512'],
    ],
});
