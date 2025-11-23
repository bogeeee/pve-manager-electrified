// ExtJS related things

Proxmox.Utils.toolkit = 'extjs';

// custom PVE specific VTypes
Ext.apply(Ext.form.field.VTypes, {
    QemuStartDate: function (v) {
        return /^(now|\d{4}-\d{1,2}-\d{1,2}(T\d{1,2}:\d{1,2}:\d{1,2})?)$/.test(v);
    },
    QemuStartDateText: gettext('Format') + ': "now" or "2006-06-17T16:01:21" or "2006-06-17"',
    IP64AddressList: (v) => PVE.Utils.verify_ip64_address_list(v, false),
    IP64AddressWithSuffixList: (v) => PVE.Utils.verify_ip64_address_list(v, true),
    IP64AddressListText: gettext('Example') + ': 192.168.1.1,192.168.1.2',
    IP64AddressListMask: /[A-Fa-f0-9,:.; ]/,
    PciIdText: gettext('Example') + ': 0x8086',
    PciId: (v) => /^0x[0-9a-fA-F]{4}$/.test(v),
});

Ext.define('PVE.form.field.Display', {
    override: 'Ext.form.field.Display',

    setSubmitValue: function (value) {
        // do nothing, this is only to allow generalized  bindings for the:
        // `me.isCreate ? 'textfield' : 'displayfield'` cases we have.
    },
});
